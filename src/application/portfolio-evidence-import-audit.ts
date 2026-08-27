import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";

import type {
  CareerClaim,
  CareerEvidenceScope,
  CareerEvidenceStore,
  CareerEvidenceValidationCode,
  CareerSource,
} from "../domain/career-evidence.js";
import {
  portfolioEvidenceImportReviewPacketSchema,
  type PortfolioEvidenceImportReviewPacket,
} from "../domain/portfolio-evidence-import-review.js";
import { SqliteCareerEvidenceStore } from "../persistence/sqlite-career-evidence-store.js";
import {
  PortfolioEvidenceImporter,
  type PortfolioEvidenceImportInput,
  type PortfolioEvidenceImportReport,
} from "./portfolio-evidence-importer.js";

export interface PortfolioEvidenceImportAuditInput {
  readonly databasePath: string;
  readonly importInput: PortfolioEvidenceImportInput;
}

export interface PortfolioEvidenceImportAuditReport
  extends PortfolioEvidenceImportReport {
  readonly canonicalDatabaseModified: false;
  readonly eligiblePublicClaimsBefore: number;
  readonly eligiblePublicClaimsAfter: number;
  readonly sourceApprovalsInvalidated: number;
  readonly publicClaimApprovalsInvalidated: number;
  readonly validationIssueCounts: Readonly<Record<CareerEvidenceValidationCode, number>>;
}

export interface PortfolioEvidenceImportReviewInput
  extends PortfolioEvidenceImportAuditInput {
  readonly now?: () => Date;
}

type SourceChangedField =
  | "new_source"
  | "source_content"
  | "title"
  | "source_type"
  | "public_citation"
  | "claim_set";

export async function runPortfolioEvidenceImportAudit(
  input: PortfolioEvidenceImportAuditInput,
): Promise<PortfolioEvidenceImportAuditReport> {
  return withImportedClone(input, (before, after, imported, scope) =>
    buildAuditReport(before, after, imported, scope)
  );
}

export async function createPortfolioEvidenceImportReviewPacket(
  input: PortfolioEvidenceImportReviewInput,
): Promise<PortfolioEvidenceImportReviewPacket> {
  return withImportedClone(input, (before, after, imported, scope) => {
    const report = buildAuditReport(before, after, imported, scope);
    const sources = buildSourceChanges(before, after, scope);
    const generatedAt = (input.now ?? (() => new Date()))().toISOString();
    const payload = {
      schemaVersion: "1.0.0" as const,
      scope,
      summary: {
        eligiblePublicClaimsBefore: report.eligiblePublicClaimsBefore,
        eligiblePublicClaimsAfter: report.eligiblePublicClaimsAfter,
        changedSources: sources.length,
        changedClaims: sources.flatMap((source) => source.claims)
          .filter((claim) => claim.status !== "unchanged").length,
      },
      sources,
    };
    const packetHash = `sha256:${createHash("sha256")
      .update(stableStringify(payload)).digest("hex")}`;
    return portfolioEvidenceImportReviewPacketSchema.parse({
      ...payload,
      packetHash,
      generatedAt,
    });
  });
}

async function withImportedClone<T>(
  input: PortfolioEvidenceImportAuditInput,
  inspect: (
    before: CareerEvidenceStore,
    after: CareerEvidenceStore,
    imported: PortfolioEvidenceImportReport,
    scope: CareerEvidenceScope,
  ) => T,
): Promise<T> {
  const databasePath = path.resolve(input.databasePath);
  const auditDirectory = await mkdtemp(path.join(tmpdir(), "jolene-portfolio-import-audit-"));
  const clonePath = path.join(auditDirectory, "jolene.sqlite");
  const scope = scopeFrom(input.importInput);
  try {
    await backupDatabase(databasePath, clonePath);
    const before = new SqliteCareerEvidenceStore(databasePath, () => new Date(), {
      readOnly: true,
    });
    const after = new SqliteCareerEvidenceStore(clonePath);
    try {
      const imported = new PortfolioEvidenceImporter(after).import(input.importInput);
      return inspect(before, after, imported, scope);
    } finally {
      before.close();
      after.close();
    }
  } finally {
    await rm(auditDirectory, { force: true, recursive: true });
  }
}

function buildAuditReport(
  before: CareerEvidenceStore,
  after: CareerEvidenceStore,
  imported: PortfolioEvidenceImportReport,
  scope: CareerEvidenceScope,
): PortfolioEvidenceImportAuditReport {
  const approvedSourceIdsBefore = approvedSourceIds(before, scope);
  const approvedSourceIdsAfter = approvedSourceIds(after, scope);
  const approvedPublicClaimIdsBefore = approvedPublicClaimIds(before, scope);
  const approvedPublicClaimIdsAfter = approvedPublicClaimIds(after, scope);
  const validationIssues = after.validate(scope);
  return {
    ...imported,
    canonicalDatabaseModified: false,
    eligiblePublicClaimsBefore: before.listPublicClaims(scope).length,
    eligiblePublicClaimsAfter: after.listPublicClaims(scope).length,
    sourceApprovalsInvalidated: differenceCount(
      approvedSourceIdsBefore,
      approvedSourceIdsAfter,
    ),
    publicClaimApprovalsInvalidated: differenceCount(
      approvedPublicClaimIdsBefore,
      approvedPublicClaimIdsAfter,
    ),
    validationIssueCounts: countValidationIssues(validationIssues.map((issue) => issue.code)),
  };
}

function buildSourceChanges(
  before: CareerEvidenceStore,
  after: CareerEvidenceStore,
  scope: CareerEvidenceScope,
) {
  const beforeSources = new Map(before.listSources(scope).map((source) => [source.id, source]));
  const afterSources = new Map(after.listSources(scope).map((source) => [source.id, source]));
  const beforeClaims = activePublicClaims(before, scope);
  const afterClaims = activeCandidateClaims(after, scope);
  const sourceIds = new Set<string>();
  for (const source of afterSources.values()) {
    if (!source.id.startsWith("portfolio:")) continue;
    const previous = beforeSources.get(source.id);
    if (!previous || sourceProjectionChanged(previous, source)) sourceIds.add(source.id);
  }
  for (const claim of afterClaims) {
    const previous = beforeClaims.find((entry) =>
      entry.sourceId === claim.sourceId && entry.logicalKey === claim.logicalKey
    );
    if (!previous || previous.id !== claim.id) sourceIds.add(claim.sourceId);
  }

  return [...sourceIds].sort().map((sourceId) => {
    const previous = beforeSources.get(sourceId) ?? null;
    const current = afterSources.get(sourceId);
    if (!current) throw new Error(`Imported portfolio source ${sourceId} is missing.`);
    const changedFields = sourceChangedFields(previous, current);
    const claims = claimChangesForSource(sourceId, beforeClaims, afterClaims);
    if (changedFields.length === 0) changedFields.push("claim_set");
    return {
      sourceId,
      changedFields,
      before: previous ? sourceProjection(previous) : null,
      after: sourceProjection(current),
      claims,
    };
  });
}

function approvedSourceIds(store: CareerEvidenceStore, scope: CareerEvidenceScope) {
  return new Set(store.listSources(scope)
    .filter((source) => source.state === "active" && source.reviewState === "approved")
    .map((source) => source.id));
}

function approvedPublicClaimIds(store: CareerEvidenceStore, scope: CareerEvidenceScope) {
  return new Set(activePublicClaims(store, scope).map((claim) => claim.id));
}

function activePublicClaims(store: CareerEvidenceStore, scope: CareerEvidenceScope) {
  return store.listClaims(scope).filter((claim) =>
    claim.state === "active" &&
    claim.reviewState === "approved" &&
    claim.visibility === "public_approved"
  );
}

function activeCandidateClaims(store: CareerEvidenceStore, scope: CareerEvidenceScope) {
  return store.listClaims(scope).filter((claim) =>
    claim.state === "active" &&
    (claim.visibility === "public_approved" || claim.visibility === "public_candidate")
  );
}

function sourceProjectionChanged(before: CareerSource, after: CareerSource): boolean {
  return before.sourceHash !== after.sourceHash ||
    before.title !== after.title ||
    before.sourceType !== after.sourceType ||
    before.provenanceUri !== after.provenanceUri;
}

function sourceChangedFields(
  before: CareerSource | null,
  after: CareerSource,
): SourceChangedField[] {
  if (!before) return ["new_source"];
  const fields: SourceChangedField[] = [];
  if (before.sourceHash !== after.sourceHash) fields.push("source_content");
  if (before.title !== after.title) fields.push("title");
  if (before.sourceType !== after.sourceType) fields.push("source_type");
  if (before.provenanceUri !== after.provenanceUri) fields.push("public_citation");
  return fields;
}

function sourceProjection(source: CareerSource) {
  if (!source.provenanceUri) {
    throw new Error(`Portfolio review source ${source.id} has no public citation.`);
  }
  return {
    title: source.title,
    sourceType: source.sourceType,
    publicCitation: source.provenanceUri,
    contentHash: source.sourceHash,
  };
}

function claimChangesForSource(
  sourceId: string,
  beforeClaims: readonly CareerClaim[],
  afterClaims: readonly CareerClaim[],
) {
  const previous = new Map(beforeClaims.filter((claim) => claim.sourceId === sourceId)
    .map((claim) => [claim.logicalKey, claim]));
  const current = new Map(afterClaims.filter((claim) => claim.sourceId === sourceId)
    .map((claim) => [claim.logicalKey, claim]));
  return [...new Set([...previous.keys(), ...current.keys()])].sort().map((logicalKey) => {
    const before = previous.get(logicalKey) ?? null;
    const after = current.get(logicalKey) ?? null;
    const status = !before ? "added" : !after ? "withdrawn" : before.id === after.id
      ? "unchanged" : "changed";
    return {
      logicalKey,
      status,
      before: before ? claimProjection(before) : null,
      after: after ? claimProjection(after) : null,
    };
  });
}

function claimProjection(claim: CareerClaim) {
  return {
    claimId: claim.visibility === "public_candidate" ? null : claim.id,
    title: claim.title,
    text: claim.proposition,
    contribution: claim.contribution,
    maturity: claim.maturity,
    visibility: claim.visibility,
  };
}

async function backupDatabase(sourcePath: string, destinationPath: string): Promise<void> {
  const database = new Database(sourcePath, { readonly: true, fileMustExist: true });
  try {
    await database.backup(destinationPath);
  } finally {
    database.close();
  }
}

function scopeFrom(input: PortfolioEvidenceImportInput): CareerEvidenceScope {
  return { actorId: input.actorId, workspaceId: input.workspaceId };
}

function differenceCount(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  return [...left].filter((value) => !right.has(value)).length;
}

function countValidationIssues(
  codes: readonly CareerEvidenceValidationCode[],
): Readonly<Record<CareerEvidenceValidationCode, number>> {
  const counts: Record<CareerEvidenceValidationCode, number> = {
    source_missing_provenance: 0,
    source_public_provenance_missing: 0,
    source_review_required: 0,
    source_review_stale: 0,
    claim_review_required: 0,
    claim_review_stale: 0,
  };
  for (const code of codes) counts[code] += 1;
  return counts;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
