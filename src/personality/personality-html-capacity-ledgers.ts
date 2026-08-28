import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { parse } from "yaml";
import { z } from "zod";

import { preallocationBoundaryDraftSchema } from
  "./personality-preallocation-boundary-draft.js";
import {
  digestHtmlLedgerArtifact, htmlLedgerFingerprintMapSchema,
} from "./personality-html-ledger-fingerprint-map.js";
import { loadPersonalitySamplingBoundaryProtocolV1 } from
  "./personality-sampling-boundary-protocol.js";
import { loadPersonalitySourceRegisterV3 } from "./personality-source-register-v3.js";
import {
  preallocationCapacityLedgerSchema, validatePreallocationCapacityLedger,
} from "./personality-preallocation-capacity-ledger.js";
import type { PreallocationCapacityLedger } from
  "./personality-preallocation-capacity-ledger.js";

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const sourceIdSchema = z.enum(["S02", "S03", "S05", "S13", "S19", "S20"]);
const reviewSchema = z.object({
  fingerprint: sha256Schema,
  reviewer_id: z.string(),
  reviewer_type: z.literal("ai"),
  tool: z.string(),
  model_version: z.string(),
  reviewed_at: z.string().datetime(),
  all_eligible_units_reviewed: z.literal(448),
  source_content_stored: z.literal(false),
}).strict();
const evidenceSchema = z.object({
  schema_version: z.literal("personality-html-capacity-review-evidence-v1"),
  created_at: z.string().datetime(),
  source_register_fingerprint: sha256Schema,
  boundary_protocol_fingerprint: sha256Schema,
  high_risk_taxonomy_fingerprint: sha256Schema,
  primary_review: reviewSchema,
  independent_review: reviewSchema,
  consensus_rule: z.literal("exact-stratum-intersection-with-uncertainty-withheld"),
  uncertain_units: z.array(z.object({
    source_register_id: sourceIdSchema,
    locator: z.string(),
    boundary_unit_fingerprint: sha256Schema,
  }).strict()),
  fingerprint_map_reviews: z.object({
    primary_verdict: z.literal("pass"),
    independent_verdict: z.literal("pass"),
    discrepancies: z.literal(0),
    source_draft_fingerprints: z.record(sourceIdSchema, sha256Schema),
    source_map_fingerprints: z.record(sourceIdSchema, sha256Schema),
  }).strict(),
  source_content_stored: z.literal(false),
  selection_performed: z.literal(false),
  observation_coding_performed: z.literal(false),
  runtime_activation: z.literal("prohibited"),
}).strict();

export async function loadPersonalityHtmlCapacityLedgersV1(projectRoot = process.cwd()) {
  const researchRoot = path.resolve(projectRoot, "research");
  const evidenceText = await readFile(path.resolve(
    researchRoot, "html-capacity-review-evidence-v1.yaml",
  ), "utf8");
  const evidence = evidenceSchema.parse(parse(evidenceText));
  const [register, protocol] = await Promise.all([
    loadPersonalitySourceRegisterV3(projectRoot),
    loadPersonalitySamplingBoundaryProtocolV1(projectRoot),
  ]);
  if (evidence.source_register_fingerprint !== register.registerFingerprint ||
      evidence.boundary_protocol_fingerprint !== protocol.protocolFingerprint ||
      evidence.high_risk_taxonomy_fingerprint !== protocol.highRiskTaxonomyFingerprint ||
      evidence.primary_review.reviewer_id === evidence.independent_review.reviewer_id ||
      Date.parse(evidence.created_at) < Date.parse(evidence.primary_review.reviewed_at) ||
      Date.parse(evidence.created_at) < Date.parse(evidence.independent_review.reviewed_at)) {
    throw new Error("HTML capacity review evidence prerequisites are stale");
  }
  const results = [];
  for (const sourceId of sourceIdSchema.options) {
    const draftText = await readFile(path.resolve(
      researchRoot, "preallocation-boundary-drafts-v1", `source-${sourceId}.yaml`,
    ), "utf8");
    const mapText = await readFile(path.resolve(
      researchRoot, "html-ledger-fingerprint-maps-v1", `source-${sourceId}.json`,
    ), "utf8");
    const ledgerText = await readFile(path.resolve(
      researchRoot, "preallocation-capacity-ledgers-v1", `source-${sourceId}.json`,
    ), "utf8");
    assertNoSourceContentFields(JSON.parse(ledgerText));
    const draft = preallocationBoundaryDraftSchema.parse(parse(draftText));
    const fingerprintMap = htmlLedgerFingerprintMapSchema.parse(JSON.parse(mapText));
    const ledger = preallocationCapacityLedgerSchema.parse(JSON.parse(ledgerText));
    if (draft.sourceRegisterId !== sourceId || fingerprintMap.sourceRegisterId !== sourceId ||
        ledger.sourceRegisterId !== sourceId ||
        fingerprintMap.boundaryDraftFingerprint !== digestHtmlLedgerArtifact(draftText) ||
        ledger.boundaryManifestFingerprint !== digestHtmlLedgerArtifact(draftText) ||
        ledger.ledgerFingerprintMapFingerprint !== digestHtmlLedgerArtifact(mapText) ||
        evidence.fingerprint_map_reviews.source_draft_fingerprints[sourceId] !==
          digestHtmlLedgerArtifact(draftText) ||
        evidence.fingerprint_map_reviews.source_map_fingerprints[sourceId] !==
          digestHtmlLedgerArtifact(mapText) ||
        ledger.primaryReviewFingerprint !== evidence.primary_review.fingerprint ||
        ledger.independentReviewFingerprint !== evidence.independent_review.fingerprint ||
        ledger.primaryReviewer.reviewerId !== evidence.primary_review.reviewer_id ||
        ledger.independentReviewer.reviewerId !== evidence.independent_review.reviewer_id ||
        ledger.primaryReviewer.reviewedAt !== evidence.primary_review.reviewed_at ||
        ledger.independentReviewer.reviewedAt !== evidence.independent_review.reviewed_at ||
        ledger.policyAmendmentFingerprint !== null) {
      throw new Error(`${sourceId} HTML capacity ledger evidence is stale`);
    }
    validateLedgerConversion(sourceId, ledger, draft, fingerprintMap, evidence);
    results.push(validatePreallocationCapacityLedger(register, protocol, ledger));
  }
  return {
    schemaVersion: "jolene.personality-html-capacity-ledgers.v1" as const,
    evidenceFingerprint: digest(evidenceText),
    ledgers: results,
    sourceContentStored: false,
    selectionPerformed: false,
    observationCodingPerformed: false,
    runtimeActivation: "prohibited" as const,
  };
}

function validateLedgerConversion(
  sourceId: z.infer<typeof sourceIdSchema>,
  ledger: PreallocationCapacityLedger,
  draft: z.infer<typeof preallocationBoundaryDraftSchema>,
  fingerprintMap: z.infer<typeof htmlLedgerFingerprintMapSchema>,
  evidence: z.infer<typeof evidenceSchema>,
): void {
  const uncertainKeys = new Set(evidence.uncertain_units
    .filter((item) => item.source_register_id === sourceId)
    .map((item) => `${item.locator}|${item.boundary_unit_fingerprint}`));
  const observedUncertain = new Set<string>();
  const records = new Map(fingerprintMap.records.map((record) => [record.recordId, record]));
  if (records.size !== fingerprintMap.records.length ||
      fingerprintMap.records.length !== draft.eligibleUnits.length + draft.excludedRanges.length ||
      ledger.sourceBoundaryUnitCount !== draft.sourceBoundaryUnitCount) {
    throw new Error(`${sourceId} HTML capacity ledger boundary is incomplete`);
  }
  for (const unit of draft.eligibleUnits) {
    const mapped = records.get(unit.unitId);
    const ledgerUnit = ledger.eligibleUnits.find((item) => item.unitId === unit.unitId);
    const uncertaintyKey = `${unit.locator.label}|${unit.segmentFingerprint}`;
    const isUncertain = uncertainKeys.has(uncertaintyKey);
    if (!mapped || mapped.locator !== unit.locator.label ||
        mapped.boundarySegmentFingerprint !== unit.segmentFingerprint ||
        !ledgerUnit || ledgerUnit.sourceUnitOrdinal !== unit.sourceUnitOrdinal ||
        ledgerUnit.segmentFingerprint !== mapped.ledgerSegmentFingerprint ||
        ledgerUnit.highRiskReviewState !==
          (isUncertain ? "uncertainty-withheld" : "consensus")) {
      throw new Error(`${sourceId} eligible HTML capacity unit is stale`);
    }
    if (isUncertain) observedUncertain.add(uncertaintyKey);
  }
  for (const range of draft.excludedRanges) {
    const mapped = records.get(range.exclusionId);
    const ledgerRange = ledger.excludedRanges.find((item) => item.exclusionId === range.exclusionId);
    if (!mapped || mapped.locator !== range.locator.label ||
        mapped.boundarySegmentFingerprint !== range.segmentFingerprint || !ledgerRange ||
        ledgerRange.sourceUnitStart !== range.sourceUnitStart ||
        ledgerRange.sourceUnitEnd !== range.sourceUnitEnd ||
        ledgerRange.segmentFingerprint !== mapped.ledgerSegmentFingerprint ||
        ledgerRange.agreedReason !== range.reason ||
        ledgerRange.primaryReason !== range.reason ||
        ledgerRange.independentReason !== range.reason) {
      throw new Error(`${sourceId} excluded HTML capacity range is stale`);
    }
  }
  if (observedUncertain.size !== uncertainKeys.size) {
    throw new Error(`${sourceId} HTML capacity uncertainty evidence is stale`);
  }
}

function assertNoSourceContentFields(input: unknown): void {
  const forbidden = new Set([
    "source_text", "text", "content", "excerpt", "quote", "transcript", "lyrics",
    "performance_material", "audio", "video", "recognizable_expression",
  ]);
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (forbidden.has(key)) throw new Error("HTML capacity ledger stores source content");
      visit(child);
    }
  };
  visit(input);
}

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
