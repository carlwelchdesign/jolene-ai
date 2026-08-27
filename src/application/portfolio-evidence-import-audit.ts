import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";

import type {
  CareerEvidenceScope,
  CareerEvidenceValidationCode,
} from "../domain/career-evidence.js";
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

export async function runPortfolioEvidenceImportAudit(
  input: PortfolioEvidenceImportAuditInput,
): Promise<PortfolioEvidenceImportAuditReport> {
  const databasePath = path.resolve(input.databasePath);
  const auditDirectory = await mkdtemp(path.join(tmpdir(), "jolene-portfolio-import-audit-"));
  const clonePath = path.join(auditDirectory, "jolene.sqlite");
  const scope = scopeFrom(input.importInput);

  try {
    await backupDatabase(databasePath, clonePath);
    const before = new SqliteCareerEvidenceStore(
      databasePath,
      () => new Date(),
      { readOnly: true },
    );
    const after = new SqliteCareerEvidenceStore(clonePath);
    try {
      const approvedSourceIdsBefore = new Set(
        before.listSources(scope)
          .filter((source) => source.state === "active" && source.reviewState === "approved")
          .map((source) => source.id),
      );
      const approvedPublicClaimIdsBefore = new Set(
        before.listClaims(scope)
          .filter((claim) =>
            claim.state === "active" &&
            claim.reviewState === "approved" &&
            claim.visibility === "public_approved"
          )
          .map((claim) => claim.id),
      );
      const eligiblePublicClaimsBefore = before.listPublicClaims(scope).length;
      const imported = new PortfolioEvidenceImporter(after).import(input.importInput);
      const approvedSourceIdsAfter = new Set(
        after.listSources(scope)
          .filter((source) => source.state === "active" && source.reviewState === "approved")
          .map((source) => source.id),
      );
      const approvedPublicClaimIdsAfter = new Set(
        after.listClaims(scope)
          .filter((claim) =>
            claim.state === "active" &&
            claim.reviewState === "approved" &&
            claim.visibility === "public_approved"
          )
          .map((claim) => claim.id),
      );
      const validationIssues = after.validate(scope);

      return {
        ...imported,
        canonicalDatabaseModified: false,
        eligiblePublicClaimsBefore,
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
    } finally {
      before.close();
      after.close();
    }
  } finally {
    await rm(auditDirectory, { force: true, recursive: true });
  }
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
