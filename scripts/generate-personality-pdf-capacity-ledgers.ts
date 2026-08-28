import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { loadPersonalityPdfCueAdjudicationAmendmentV1 } from
  "../src/personality/personality-pdf-cue-amendment.js";
import { mapPdfBoundaryExclusionReason } from
  "../src/personality/personality-pdf-capacity-ledgers.js";
import { preflightPersonalityPdfCapacityReviews } from
  "../src/personality/personality-pdf-capacity-review-preflight.js";
import { loadPersonalitySamplingBoundaryProtocolV1 } from
  "../src/personality/personality-sampling-boundary-protocol.js";
import { loadPersonalitySourceRegisterV3 } from
  "../src/personality/personality-source-register-v3.js";
import {
  validatePreallocationCapacityLedger,
} from "../src/personality/personality-preallocation-capacity-ledger.js";
import type { PreallocationCapacityLedger } from
  "../src/personality/personality-preallocation-capacity-ledger.js";

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const sourceIdSchema = z.enum(["S04", "S08", "S09", "S18"]);
const strataSchema = z.enum([
  "belief", "biography", "boundary", "contradiction", "grief-or-hurt", "humor",
  "identity-trait", "politics", "voice-adjacent", "workplace-sexual-boundary",
]);
const tagSchema = z.object({
  locator: z.string(), fingerprint: sha256Schema, strata: z.array(strataSchema),
}).strict();
const primarySchema = z.object({
  schema_version: z.literal("jol-per-005c2-primary-metadata-review-v1"),
  reviewer_id: z.string(), completed_at_utc: z.string().datetime(), tool: z.string(),
  model: z.array(z.string()).min(1), source_content_stored: z.literal(false),
  selection_performed: z.literal(false), observation_coding_performed: z.literal(false),
  runtime_activation: z.literal("prohibited"),
  review_attestation: z.record(sourceIdSchema, z.object({
    reviewed_eligible: z.number().int(), tagged: z.number().int(),
    zero_tag: z.number().int(), ambiguous: z.number().int(),
    all_omitted_eligible_units_reviewed_and_assigned_zero_tags: z.literal(true),
  }).strict()),
  sources: z.array(z.object({
    source: sourceIdSchema, event: z.string(), source_fingerprint: sha256Schema,
    boundary: z.number().int(), eligible: z.number().int(), excluded: z.number().int(),
    boundary_manifest_fingerprint: sha256Schema,
    ledger_fingerprint_map_fingerprint: sha256Schema,
  }).strict()).length(4),
  tagged_units: z.record(sourceIdSchema, z.array(tagSchema)),
  ambiguous_units: z.record(sourceIdSchema, z.array(z.unknown())),
  stability_comparison: z.object({
    prior_ambiguous_unit: z.object({
      source: sourceIdSchema, locator: z.string(), fingerprint: sha256Schema,
      strata: z.array(strataSchema),
    }).nullable().optional(),
  }).passthrough(),
}).passthrough();
const independentSchema = z.object({
  schema_version: z.literal("independent-trust-rights-pdf-review-compact-v1"),
  completed_at: z.string().datetime(),
  reviewer: z.object({
    reviewer_id: z.string(), tool: z.string(), model: z.string(),
  }).passthrough(),
  source_register_fingerprint: sha256Schema,
  boundary_protocol_fingerprint: sha256Schema,
  s04_cue_amendment_fingerprint: sha256Schema,
  taxonomy_fingerprint: sha256Schema,
  eligible_units_reviewed: z.literal(140),
  eligible_units_with_nonempty_tags: z.literal(97),
  tagged_eligible_units: z.array(z.object({
    source_register_id: sourceIdSchema, locator: z.string(),
    unit_fingerprint: sha256Schema, high_risk_strata: z.array(strataSchema),
  }).strict()),
  eligible_units_omitted_zero_tag_attestation: z.literal(43),
  sources: z.array(z.object({
    source_register_id: sourceIdSchema, source_content_fingerprint: sha256Schema,
    boundary_units: z.number().int(), eligible_units: z.number().int(),
    excluded_units: z.number().int(), boundary_verdict: z.literal("pass"),
    manifest_fingerprint: sha256Schema, excluded_discrepancies: z.array(z.never()),
  }).strict()).length(4),
  ambiguous_units: z.array(z.object({
    source_register_id: sourceIdSchema, locator: z.string(), unit_fingerprint: sha256Schema,
  }).strict()),
  rights_audit: z.object({
    verdict: z.literal("pass"), source_content_persisted: z.literal(false),
    selection_performed: z.literal(false), observation_coding_performed: z.literal(false),
    runtime_activation: z.literal("prohibited"),
  }).passthrough(),
}).passthrough();
const manifestSchema = z.object({
  source_register_id: sourceIdSchema, source_event_id: z.string(),
  source_content_fingerprint: sha256Schema,
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

const projectRoot = process.cwd();
const primaryPath = process.env.JOLENE_PRIMARY_PDF_REVIEW;
const independentPath = process.env.JOLENE_INDEPENDENT_PDF_REVIEW;
if (!primaryPath || !independentPath) {
  throw new Error(
    "JOLENE_PRIMARY_PDF_REVIEW and JOLENE_INDEPENDENT_PDF_REVIEW are required",
  );
}
const primaryText = await readFile(primaryPath, "utf8");
const independentText = await readFile(independentPath, "utf8");
const evidenceText = await readFile(path.resolve(
  projectRoot, "research/pdf-capacity-review-evidence-v1.yaml",
), "utf8");
const primary = primarySchema.parse(JSON.parse(primaryText));
const independent = independentSchema.parse(JSON.parse(independentText));
const [register, protocol, amendment] = await Promise.all([
  loadPersonalitySourceRegisterV3(projectRoot),
  loadPersonalitySamplingBoundaryProtocolV1(projectRoot),
  loadPersonalityPdfCueAdjudicationAmendmentV1(projectRoot),
]);
const preflight = preflightPersonalityPdfCapacityReviews(
  primaryText, independentText, evidenceText, {
    sourceRegisterFingerprint: register.registerFingerprint,
    boundaryProtocolFingerprint: protocol.protocolFingerprint,
    highRiskTaxonomyFingerprint: protocol.highRiskTaxonomyFingerprint,
    s04CueAmendmentFingerprint: amendment.amendmentFingerprint,
  },
);
if (independent.source_register_fingerprint !== register.registerFingerprint ||
    independent.boundary_protocol_fingerprint !== protocol.protocolFingerprint ||
    independent.s04_cue_amendment_fingerprint !== amendment.amendmentFingerprint ||
    independent.taxonomy_fingerprint !== protocol.highRiskTaxonomyFingerprint ||
    Object.values(primary.review_attestation).some((item) =>
      item.ambiguous !== 0 || item.reviewed_eligible !== item.tagged + item.zero_tag
    )) throw new Error("PDF review prerequisites or complete-review attestations are invalid");

const primaryFingerprint = preflight.primaryReviewFingerprint;
const independentFingerprint = preflight.independentReviewFingerprint;
const outputRoot = process.env.JOLENE_PDF_LEDGER_OUTPUT_ROOT ?
  path.resolve(process.env.JOLENE_PDF_LEDGER_OUTPUT_ROOT) :
  path.resolve(projectRoot, "research/preallocation-capacity-ledgers-v1");
const summaries = [];
const outputs: Array<{ path: string; text: string }> = [];
for (const sourceId of sourceIdSchema.options) {
  const manifestText = await readFile(path.resolve(
    projectRoot, "research/pdf-boundary-manifests-v1", `source-${sourceId}.json`,
  ), "utf8");
  const mapText = await readFile(path.resolve(
    projectRoot, "research/pdf-ledger-fingerprint-maps-v1", `source-${sourceId}.json`,
  ), "utf8");
  const manifest = manifestSchema.parse(JSON.parse(manifestText));
  const fingerprintMap = mapSchema.parse(JSON.parse(mapText));
  const primarySource = primary.sources.find((item) => item.source === sourceId);
  const independentSource = independent.sources.find(
    (item) => item.source_register_id === sourceId,
  );
  const eligibleCount = manifest.units.filter((item) => item.disposition === "eligible").length;
  if (!primarySource || primarySource.boundary_manifest_fingerprint !== digest(manifestText) ||
      primarySource.ledger_fingerprint_map_fingerprint !== digest(mapText) ||
      primarySource.boundary !== manifest.units.length || primarySource.eligible !== eligibleCount ||
      primarySource.excluded !== manifest.units.length - eligibleCount ||
      primarySource.source_fingerprint !== manifest.source_content_fingerprint ||
      primary.review_attestation[sourceId].reviewed_eligible !== eligibleCount ||
      primary.review_attestation[sourceId].tagged !== primary.tagged_units[sourceId].length ||
      primary.review_attestation[sourceId].zero_tag !==
        eligibleCount - primary.tagged_units[sourceId].length || !independentSource ||
      independentSource.manifest_fingerprint !== digest(manifestText) ||
      independentSource.boundary_units !== manifest.units.length ||
      independentSource.eligible_units !== eligibleCount ||
      independentSource.excluded_units !== manifest.units.length - eligibleCount ||
      independentSource.source_content_fingerprint !== manifest.source_content_fingerprint) {
    throw new Error(`${sourceId} primary review evidence is stale`);
  }
  const primaryTags = new Map<string, z.infer<typeof strataSchema>[]>(
    primary.tagged_units[sourceId].map((item) =>
    [`${item.locator}|${item.fingerprint}`, item.strata] as const
  ));
  const independentTags = new Map<string, z.infer<typeof strataSchema>[]>(
    independent.tagged_eligible_units
    .filter((item) => item.source_register_id === sourceId)
    .map((item) => [
      `${item.locator}|${item.unit_fingerprint}`, item.high_risk_strata,
    ] as const));
  const consensusBlockedKeys = new Set(independent.ambiguous_units
    .filter((item) => item.source_register_id === sourceId)
    .map((item) => `${item.locator}|${item.unit_fingerprint}`));
  const priorAmbiguous = primary.stability_comparison.prior_ambiguous_unit;
  if (priorAmbiguous?.source === sourceId) {
    consensusBlockedKeys.add(`${priorAmbiguous.locator}|${priorAmbiguous.fingerprint}`);
  }
  const usedPrimaryKeys = new Set<string>();
  const usedIndependentKeys = new Set<string>();
  const eligibleUnits: PreallocationCapacityLedger["eligibleUnits"] = [];
  const excludedRanges: PreallocationCapacityLedger["excludedRanges"] = [];
  manifest.units.forEach((unit, sourceUnitOrdinal) => {
    const converted = fingerprintMap.units[sourceUnitOrdinal];
    if (!converted || converted.locator !== unit.locator ||
        converted.boundary_unit_fingerprint !== unit.unit_fingerprint) {
      throw new Error(`${sourceId} review-to-ledger fingerprint conversion is stale`);
    }
    const locator = locatorFor(sourceId, sourceUnitOrdinal);
    if (unit.disposition === "eligible") {
      const key = `${unit.locator}|${unit.unit_fingerprint}`;
      const primaryStrata = [...(primaryTags.get(key) ?? [])].sort();
      const independentStrata = [...(independentTags.get(key) ?? [])].sort();
      if (primaryTags.has(key)) usedPrimaryKeys.add(key);
      if (independentTags.has(key)) usedIndependentKeys.add(key);
      const rawConsensus = primaryStrata.filter((tag) => independentStrata.includes(tag));
      const withheld = consensusBlockedKeys.has(key) ? rawConsensus : [];
      eligibleUnits.push({
        unitId: `C-${sourceId}-${String(eligibleUnits.length + 1).padStart(4, "0")}`,
        sourceUnitOrdinal, locator,
        segmentFingerprint: converted.ledger_segment_fingerprint,
        primaryEligibility: "eligible", independentEligibility: "eligible",
        primaryHighRiskStrata: primaryStrata,
        independentHighRiskStrata: independentStrata,
        agreedHighRiskStrata: rawConsensus.filter((tag) => !withheld.includes(tag)),
        consensusWithheldHighRiskStrata: withheld,
        highRiskReviewState: consensusBlockedKeys.has(key) ?
          "uncertainty-withheld" : "consensus",
      });
    } else {
      const reason = mapPdfBoundaryExclusionReason(unit.reason);
      excludedRanges.push({
        exclusionId: `CX-${sourceId}-${String(excludedRanges.length + 1).padStart(4, "0")}`,
        sourceUnitStart: sourceUnitOrdinal, sourceUnitEnd: sourceUnitOrdinal, locator,
        segmentFingerprint: converted.ledger_segment_fingerprint,
        primaryReason: reason, independentReason: reason, agreedReason: reason,
      });
    }
  });
  if (primaryTags.size !== primary.tagged_units[sourceId].length ||
      usedPrimaryKeys.size !== primaryTags.size || usedIndependentKeys.size !== independentTags.size ||
      independentTags.size !== independent.tagged_eligible_units.filter(
        (item) => item.source_register_id === sourceId,
      ).length) throw new Error(`${sourceId} review contains duplicate tag records`);
  const ledger: PreallocationCapacityLedger = {
    schemaVersion: "jolene.personality-preallocation-capacity-ledger.v1",
    status: "independently-reviewed-before-allocation",
    sourceRegisterFingerprint: register.registerFingerprint,
    boundaryProtocolFingerprint: protocol.protocolFingerprint,
    highRiskTaxonomyFingerprint: protocol.highRiskTaxonomyFingerprint,
    sourceRegisterId: sourceId, sourceEventId: manifest.source_event_id,
    sourceContentFingerprint: manifest.source_content_fingerprint,
    boundaryManifestFingerprint: digest(manifestText),
    ledgerFingerprintMapFingerprint: digest(mapText),
    policyAmendmentFingerprint: sourceId === "S04" ? amendment.amendmentFingerprint : null,
    primaryReviewFingerprint: primaryFingerprint,
    independentReviewFingerprint: independentFingerprint,
    segmentationRule: sourceId === "S18" ? "pdf-attributed-statement-blocks-v2" :
      "pdf-speaker-label-blocks-v2",
    sourceBoundaryUnitCount: manifest.units.length, frozenAt: "2026-08-28T06:30:00Z",
    primaryReviewer: { reviewerId: primary.reviewer_id, reviewerType: "ai",
      tool: primary.tool, modelVersion: primary.model.join(","),
      reviewedAt: primary.completed_at_utc },
    independentReviewer: { reviewerId: independent.reviewer.reviewer_id,
      reviewerType: "ai", tool: independent.reviewer.tool,
      modelVersion: independent.reviewer.model, reviewedAt: independent.completed_at },
    eligibleUnits, excludedRanges, sourceContentStored: false,
    frozenBeforeAllocation: true, selectionPerformed: false,
    observationCodingPerformed: false, runtimeActivation: "prohibited",
  };
  const validated = validatePreallocationCapacityLedger(register, protocol, ledger);
  const output = path.resolve(outputRoot, `source-${sourceId}.json`);
  outputs.push({ path: output, text: `${JSON.stringify(ledger, null, 2)}\n` });
  summaries.push(validated);
}
if (independent.tagged_eligible_units.length !== independent.eligible_units_with_nonempty_tags ||
    independent.eligible_units_reviewed - independent.tagged_eligible_units.length !==
      independent.eligible_units_omitted_zero_tag_attestation) {
  throw new Error("Independent review tag attestation is inconsistent");
}
await mkdir(outputRoot, { recursive: true });
for (const output of outputs) {
  const temporary = `${output.path}.${process.pid}.tmp`;
  await writeFile(temporary, output.text, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, output.path);
}
process.stdout.write(`${JSON.stringify({
  primaryReviewFingerprint: primaryFingerprint,
  independentReviewFingerprint: independentFingerprint, summaries,
}, null, 2)}\n`);

function locatorFor(sourceId: z.infer<typeof sourceIdSchema>, ordinal: number) {
  const kind = sourceId === "S18" ? "paragraph-index" as const : "speaker-block-index" as const;
  const prefix = sourceId === "S18" ? "paragraph" : "speaker-block";
  return { kind, start: ordinal, end: ordinal, label: `${prefix}-${ordinal}` };
}

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
