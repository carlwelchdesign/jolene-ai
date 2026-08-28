import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { parse } from "yaml";
import { z } from "zod";

import { loadPersonalityPdfCueAdjudicationAmendmentV1 } from
  "./personality-pdf-cue-amendment.js";
import { loadPersonalitySamplingBoundaryProtocolV1 } from
  "./personality-sampling-boundary-protocol.js";
import { loadPersonalitySourceRegisterV3 } from
  "./personality-source-register-v3.js";
import {
  preallocationCapacityLedgerSchema, validatePreallocationCapacityLedger,
} from "./personality-preallocation-capacity-ledger.js";
import type { PreallocationCapacityLedger } from
  "./personality-preallocation-capacity-ledger.js";

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const sourceIdSchema = z.enum(["S04", "S08", "S09", "S18"]);
const reviewSchema = z.object({
  fingerprint: sha256Schema, reviewer_id: z.string(), reviewer_type: z.literal("ai"),
  tool: z.string(), model_version: z.string(), reviewed_at: z.string().datetime(),
  all_eligible_units_reviewed: z.literal(140), source_content_stored: z.literal(false),
}).strict();
const evidenceSchema = z.object({
  schema_version: z.literal("personality-pdf-capacity-review-evidence-v1"),
  created_at: z.string().datetime(), source_register_fingerprint: sha256Schema,
  boundary_protocol_fingerprint: sha256Schema,
  high_risk_taxonomy_fingerprint: sha256Schema,
  s04_cue_amendment_fingerprint: sha256Schema,
  primary_review: reviewSchema, independent_review: reviewSchema,
  consensus_rule: z.literal("exact-stratum-intersection-with-uncertainty-withheld"),
  uncertain_units: z.array(z.object({
    source_register_id: sourceIdSchema, locator: z.string(),
    boundary_unit_fingerprint: sha256Schema,
  }).strict()).length(9),
  fingerprint_map_reviews: z.object({
    primary_verdict: z.literal("pass"), independent_verdict: z.literal("pass"),
    discrepancies: z.literal(0),
    source_map_fingerprints: z.record(sourceIdSchema, sha256Schema),
  }).strict(),
  source_content_stored: z.literal(false), selection_performed: z.literal(false),
  observation_coding_performed: z.literal(false), runtime_activation: z.literal("prohibited"),
}).strict();
const manifestSchema = z.object({
  units: z.array(z.object({
    locator: z.string(), unit_fingerprint: sha256Schema,
    disposition: z.enum(["eligible", "excluded"]), reason: z.string(),
  }).passthrough()),
}).passthrough();
const mapSchema = z.object({
  units: z.array(z.object({
    locator: z.string(), boundary_unit_fingerprint: sha256Schema,
    ledger_segment_fingerprint: sha256Schema,
  }).strict()),
}).passthrough();

export async function loadPersonalityPdfCapacityLedgersV1(projectRoot = process.cwd()) {
  const researchRoot = path.resolve(projectRoot, "research");
  const evidenceText = await readFile(path.resolve(
    researchRoot, "pdf-capacity-review-evidence-v1.yaml",
  ), "utf8");
  const evidence = evidenceSchema.parse(parse(evidenceText));
  const [register, protocol, amendment] = await Promise.all([
    loadPersonalitySourceRegisterV3(projectRoot),
    loadPersonalitySamplingBoundaryProtocolV1(projectRoot),
    loadPersonalityPdfCueAdjudicationAmendmentV1(projectRoot),
  ]);
  if (evidence.source_register_fingerprint !== register.registerFingerprint ||
      evidence.boundary_protocol_fingerprint !== protocol.protocolFingerprint ||
      evidence.high_risk_taxonomy_fingerprint !== protocol.highRiskTaxonomyFingerprint ||
      evidence.s04_cue_amendment_fingerprint !== amendment.amendmentFingerprint ||
      Date.parse(evidence.created_at) < Date.parse(evidence.primary_review.reviewed_at) ||
      Date.parse(evidence.created_at) < Date.parse(evidence.independent_review.reviewed_at)) {
    throw new Error("PDF capacity review evidence prerequisites are stale");
  }
  const results = [];
  for (const sourceId of sourceIdSchema.options) {
    const manifestText = await readFile(path.resolve(
      researchRoot, "pdf-boundary-manifests-v1", `source-${sourceId}.json`,
    ), "utf8");
    const mapText = await readFile(path.resolve(
      researchRoot, "pdf-ledger-fingerprint-maps-v1", `source-${sourceId}.json`,
    ), "utf8");
    const ledgerText = await readFile(path.resolve(
      researchRoot, "preallocation-capacity-ledgers-v1", `source-${sourceId}.json`,
    ), "utf8");
    assertNoSourceContentFields(JSON.parse(ledgerText));
    const manifest = manifestSchema.parse(JSON.parse(manifestText));
    const fingerprintMap = mapSchema.parse(JSON.parse(mapText));
    const ledger = preallocationCapacityLedgerSchema.parse(JSON.parse(ledgerText));
    if (ledger.sourceRegisterId !== sourceId ||
        ledger.boundaryManifestFingerprint !== digest(manifestText) ||
        ledger.ledgerFingerprintMapFingerprint !== digest(mapText) ||
        evidence.fingerprint_map_reviews.source_map_fingerprints[sourceId] !== digest(mapText) ||
        ledger.primaryReviewFingerprint !== evidence.primary_review.fingerprint ||
        ledger.independentReviewFingerprint !== evidence.independent_review.fingerprint ||
        ledger.primaryReviewer.reviewerId !== evidence.primary_review.reviewer_id ||
        ledger.independentReviewer.reviewerId !== evidence.independent_review.reviewer_id ||
        ledger.primaryReviewer.reviewedAt !== evidence.primary_review.reviewed_at ||
        ledger.independentReviewer.reviewedAt !== evidence.independent_review.reviewed_at ||
        ledger.policyAmendmentFingerprint !==
          (sourceId === "S04" ? amendment.amendmentFingerprint : null)) {
      throw new Error(`${sourceId} PDF capacity ledger evidence is stale`);
    }
    validateLedgerConversion(sourceId, ledger, manifest, fingerprintMap, evidence);
    results.push(validatePreallocationCapacityLedger(register, protocol, ledger));
  }
  return {
    schemaVersion: "jolene.personality-pdf-capacity-ledgers.v1" as const,
    evidenceFingerprint: digest(evidenceText), ledgers: results,
    sourceContentStored: false, selectionPerformed: false,
    observationCodingPerformed: false, runtimeActivation: "prohibited" as const,
  };
}

function validateLedgerConversion(
  sourceId: z.infer<typeof sourceIdSchema>,
  ledger: PreallocationCapacityLedger,
  manifest: z.infer<typeof manifestSchema>,
  fingerprintMap: z.infer<typeof mapSchema>,
  evidence: z.infer<typeof evidenceSchema>,
): void {
  const uncertainKeys = new Set(evidence.uncertain_units
    .filter((item) => item.source_register_id === sourceId)
    .map((item) => `${item.locator}|${item.boundary_unit_fingerprint}`));
  const observedUncertain = new Set<string>();
  if (manifest.units.length !== ledger.sourceBoundaryUnitCount ||
      fingerprintMap.units.length !== manifest.units.length) {
    throw new Error(`${sourceId} PDF capacity ledger boundary is incomplete`);
  }
  manifest.units.forEach((unit, ordinal) => {
    const mapped = fingerprintMap.units[ordinal];
    if (!mapped || mapped.locator !== unit.locator ||
        mapped.boundary_unit_fingerprint !== unit.unit_fingerprint) {
      throw new Error(`${sourceId} PDF capacity ledger fingerprint map is stale`);
    }
    const uncertaintyKey = `${unit.locator}|${unit.unit_fingerprint}`;
    const isUncertain = uncertainKeys.has(uncertaintyKey);
    if (unit.disposition === "eligible") {
      const ledgerUnit = ledger.eligibleUnits.find((item) => item.sourceUnitOrdinal === ordinal);
      if (!ledgerUnit || ledgerUnit.segmentFingerprint !== mapped.ledger_segment_fingerprint ||
          ledgerUnit.highRiskReviewState !==
            (isUncertain ? "uncertainty-withheld" : "consensus")) {
        throw new Error(`${sourceId} eligible PDF capacity unit is stale`);
      }
      if (isUncertain) observedUncertain.add(uncertaintyKey);
    } else {
      const range = ledger.excludedRanges.find((item) =>
        item.sourceUnitStart === ordinal && item.sourceUnitEnd === ordinal
      );
      const reason = mapPdfBoundaryExclusionReason(unit.reason);
      if (!range || range.segmentFingerprint !== mapped.ledger_segment_fingerprint ||
          range.agreedReason !== reason || range.primaryReason !== reason ||
          range.independentReason !== reason || isUncertain) {
        throw new Error(`${sourceId} excluded PDF capacity unit is stale`);
      }
    }
  });
  if (observedUncertain.size !== uncertainKeys.size) {
    throw new Error(`${sourceId} PDF capacity uncertainty evidence is stale`);
  }
}

export function mapPdfBoundaryExclusionReason(reason: string):
  PreallocationCapacityLedger["excludedRanges"][number]["agreedReason"] {
  const mapping = {
    "prelabel-non-dialogue": "not-atomic",
    "other-speaker": "interviewer-or-other-speaker",
    "performance-cue-whole-block": "lyric-or-performance",
    "cue-only-or-empty": "non-verbal",
    "closed-set-fragment": "too-fragmentary",
  } as const;
  const result = mapping[reason as keyof typeof mapping];
  if (!result) throw new Error(`Unknown PDF exclusion reason: ${reason}`);
  return result;
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
      if (forbidden.has(key)) throw new Error("PDF capacity ledger stores source content");
      visit(child);
    }
  };
  visit(input);
}

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
