import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { parse } from "yaml";
import { z } from "zod";

import { preallocationBoundaryDraftSchema, validatePreallocationBoundaryDraft } from
  "../src/personality/personality-preallocation-boundary-draft.js";
import { preflightPersonalityHtmlCapacityReviews } from
  "../src/personality/personality-html-capacity-review-preflight.js";
import { htmlLedgerFingerprintMapSchema } from
  "../src/personality/personality-html-ledger-fingerprint-map.js";
import { loadPersonalitySamplingBoundaryProtocolV1 } from
  "../src/personality/personality-sampling-boundary-protocol.js";
import { loadPersonalitySourceRegisterV3 } from
  "../src/personality/personality-source-register-v3.js";
import { validatePreallocationCapacityLedger } from
  "../src/personality/personality-preallocation-capacity-ledger.js";
import type { PreallocationCapacityLedger } from
  "../src/personality/personality-preallocation-capacity-ledger.js";

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const sourceIdSchema = z.enum(["S02", "S03", "S05", "S13", "S19", "S20"]);
const strataSchema = z.enum([
  "belief", "biography", "boundary", "contradiction", "grief-or-hurt", "humor",
  "identity-trait", "politics", "voice-adjacent", "workplace-sexual-boundary",
]);
const taggedUnitSchema = z.object({
  source_register_id: sourceIdSchema,
  locator: z.string(),
  unit_fingerprint: sha256Schema,
  high_risk_strata: z.array(strataSchema),
}).strict();
const reportSchema = z.object({
  schema_version: z.literal("personality-html-capacity-review-v1"),
  review_role: z.enum(["primary", "independent"]),
  reviewer: z.object({
    reviewer_id: z.string(), tool: z.string(),
    model: z.union([z.string(), z.array(z.string()).min(1)]),
    reviewed_at: z.string().datetime(),
  }).strict(),
  source_register_fingerprint: sha256Schema,
  boundary_protocol_fingerprint: sha256Schema,
  high_risk_taxonomy_fingerprint: sha256Schema,
  eligible_units_reviewed: z.literal(448),
  eligible_units_with_nonempty_tags: z.number().int().nonnegative(),
  zero_tag_attestation: z.union([
    z.object({
      eligible_units: z.number().int().nonnegative(),
      all_omitted_eligible_units_reviewed_and_assigned_zero_tags: z.literal(true),
    }).strict(),
    z.object({
      eligible_units_with_zero_tags: z.number().int().nonnegative(),
      all_eligible_units_not_listed_in_tagged_eligible_units_were_reviewed_and_assigned_zero_tags:
        z.literal(true),
      by_source: z.record(sourceIdSchema, z.unknown()),
    }).strict(),
  ]),
  sources: z.array(z.object({
    source_register_id: sourceIdSchema,
    source_event_id: z.string(),
    source_content_fingerprint: sha256Schema,
    boundary_units: z.number().int(),
    eligible_units: z.number().int(),
    excluded_units: z.number().int(),
    boundary_draft_fingerprint: sha256Schema,
    ledger_fingerprint_map_fingerprint: sha256Schema,
    boundary_verdict: z.literal("pass"),
    discrepancies: z.array(z.never()),
  }).strict()).length(6),
  tagged_eligible_units: z.array(taggedUnitSchema),
  ambiguous_units: z.array(taggedUnitSchema.omit({ high_risk_strata: true })),
  rights_audit: z.object({
    verdict: z.literal("pass"),
    source_content_persisted: z.literal(false),
    selection_performed: z.literal(false),
    observation_coding_performed: z.literal(false),
    runtime_activation: z.literal("prohibited"),
  }).strict(),
}).strict();

const projectRoot = process.cwd();
const primaryPath = process.env.JOLENE_PRIMARY_HTML_REVIEW;
const independentPath = process.env.JOLENE_INDEPENDENT_HTML_REVIEW;
if (!primaryPath || !independentPath) {
  throw new Error("JOLENE_PRIMARY_HTML_REVIEW and JOLENE_INDEPENDENT_HTML_REVIEW are required");
}
const primaryText = await readFile(primaryPath, "utf8");
const independentText = await readFile(independentPath, "utf8");
const evidenceText = await readFile(path.resolve(
  projectRoot, "research/html-capacity-review-evidence-v1.yaml",
), "utf8");
const primary = reportSchema.parse(JSON.parse(primaryText));
const independent = reportSchema.parse(JSON.parse(independentText));
if (primary.review_role !== "primary" || independent.review_role !== "independent") {
  throw new Error("HTML capacity review roles are invalid");
}
for (const report of [primary, independent]) {
  if (report.eligible_units_with_nonempty_tags !== report.tagged_eligible_units.length ||
      report.eligible_units_reviewed - report.tagged_eligible_units.length !==
        zeroTagCount(report.zero_tag_attestation) ||
      new Set(report.sources.map((item) => item.source_register_id)).size !== 6 ||
      report.tagged_eligible_units.some((item) =>
        new Set(item.high_risk_strata).size !== item.high_risk_strata.length
      )) {
    throw new Error(`${report.review_role} HTML tag attestation is inconsistent`);
  }
}
const [register, protocol] = await Promise.all([
  loadPersonalitySourceRegisterV3(projectRoot),
  loadPersonalitySamplingBoundaryProtocolV1(projectRoot),
]);
const preflight = preflightPersonalityHtmlCapacityReviews(
  primaryText, independentText, evidenceText, {
    sourceRegisterFingerprint: register.registerFingerprint,
    boundaryProtocolFingerprint: protocol.protocolFingerprint,
    highRiskTaxonomyFingerprint: protocol.highRiskTaxonomyFingerprint,
  },
);
const outputRoot = process.env.JOLENE_HTML_LEDGER_OUTPUT_ROOT
  ? path.resolve(process.env.JOLENE_HTML_LEDGER_OUTPUT_ROOT)
  : path.resolve(projectRoot, "research/preallocation-capacity-ledgers-v1");
const outputs: Array<{ path: string; text: string }> = [];
const summaries = [];
for (const sourceId of sourceIdSchema.options) {
  const draftText = await readFile(path.resolve(
    projectRoot, "research/preallocation-boundary-drafts-v1", `source-${sourceId}.yaml`,
  ), "utf8");
  const mapText = await readFile(path.resolve(
    projectRoot, "research/html-ledger-fingerprint-maps-v1", `source-${sourceId}.json`,
  ), "utf8");
  const draft = preallocationBoundaryDraftSchema.parse(parse(draftText));
  const map = htmlLedgerFingerprintMapSchema.parse(JSON.parse(mapText));
  validatePreallocationBoundaryDraft(register, protocol, draft);
  const primarySource = primary.sources.find((item) => item.source_register_id === sourceId);
  const independentSource = independent.sources.find((item) => item.source_register_id === sourceId);
  const excludedUnits = draft.sourceBoundaryUnitCount - draft.eligibleUnits.length;
  for (const reviewed of [primarySource, independentSource]) {
    if (!reviewed || reviewed.source_event_id !== draft.sourceEventId ||
        reviewed.source_content_fingerprint !== draft.sourceContentFingerprint ||
        reviewed.boundary_units !== draft.sourceBoundaryUnitCount ||
        reviewed.eligible_units !== draft.eligibleUnits.length ||
        reviewed.excluded_units !== excludedUnits ||
        reviewed.boundary_draft_fingerprint !== digest(draftText) ||
        reviewed.ledger_fingerprint_map_fingerprint !== digest(mapText)) {
      throw new Error(`${sourceId} HTML capacity review evidence is stale`);
    }
  }
  const records = new Map(map.records.map((record) => [record.recordId, record]));
  if (records.size !== map.records.length ||
      map.records.length !== draft.eligibleUnits.length + draft.excludedRanges.length ||
      map.boundaryDraftFingerprint !== digest(draftText) ||
      map.sourceContentFingerprint !== draft.sourceContentFingerprint) {
    throw new Error(`${sourceId} HTML fingerprint map is incomplete or stale`);
  }
  const primaryTags = tagsFor(primary, sourceId);
  const independentTags = tagsFor(independent, sourceId);
  const primaryAmbiguity = ambiguityKeys(primary, sourceId);
  const independentAmbiguity = ambiguityKeys(independent, sourceId);
  const ambiguous = new Set([...primaryAmbiguity, ...independentAmbiguity]);
  const eligibleKeys = new Set(draft.eligibleUnits.map(
    (unit) => `${unit.locator.label}|${unit.segmentFingerprint}`,
  ));
  if (primaryTags.size !== taggedCount(primary, sourceId) ||
      independentTags.size !== taggedCount(independent, sourceId) ||
      new Set(primaryAmbiguity).size !== primaryAmbiguity.length ||
      new Set(independentAmbiguity).size !== independentAmbiguity.length ||
      [...primaryTags.keys(), ...independentTags.keys(), ...ambiguous].some(
        (key) => !eligibleKeys.has(key),
      )) {
    throw new Error(`${sourceId} HTML review identities are stale or duplicated`);
  }
  const usedPrimary = new Set<string>();
  const usedIndependent = new Set<string>();
  const eligibleUnits: PreallocationCapacityLedger["eligibleUnits"] = draft.eligibleUnits.map(
    (unit) => {
      const record = records.get(unit.unitId);
      if (!record || record.locator !== unit.locator.label ||
          record.boundarySegmentFingerprint !== unit.segmentFingerprint) {
        throw new Error(`${sourceId} HTML fingerprint conversion is stale`);
      }
      const key = `${unit.locator.label}|${unit.segmentFingerprint}`;
      const primaryStrata = [...(primaryTags.get(key) ?? [])].sort();
      const independentStrata = [...(independentTags.get(key) ?? [])].sort();
      if (primaryTags.has(key)) usedPrimary.add(key);
      if (independentTags.has(key)) usedIndependent.add(key);
      const rawConsensus = primaryStrata.filter((stratum) => independentStrata.includes(stratum));
      const withheld = ambiguous.has(key) ? rawConsensus : [];
      return {
        ...unit,
        segmentFingerprint: record.ledgerSegmentFingerprint,
        primaryEligibility: "eligible" as const,
        independentEligibility: "eligible" as const,
        primaryHighRiskStrata: primaryStrata,
        independentHighRiskStrata: independentStrata,
        agreedHighRiskStrata: rawConsensus.filter((stratum) => !withheld.includes(stratum)),
        consensusWithheldHighRiskStrata: withheld,
        highRiskReviewState: ambiguous.has(key) ? "uncertainty-withheld" as const :
          "consensus" as const,
      };
    },
  );
  const excludedRanges: PreallocationCapacityLedger["excludedRanges"] =
    draft.excludedRanges.map((range) => {
      const record = records.get(range.exclusionId);
      if (!record || record.locator !== range.locator.label ||
          record.boundarySegmentFingerprint !== range.segmentFingerprint) {
        throw new Error(`${sourceId} HTML exclusion fingerprint conversion is stale`);
      }
      return {
        exclusionId: range.exclusionId,
        sourceUnitStart: range.sourceUnitStart,
        sourceUnitEnd: range.sourceUnitEnd,
        locator: range.locator,
        segmentFingerprint: record.ledgerSegmentFingerprint,
        primaryReason: range.reason,
        independentReason: range.reason,
        agreedReason: range.reason,
      };
    });
  if (usedPrimary.size !== primaryTags.size || usedIndependent.size !== independentTags.size) {
    throw new Error(`${sourceId} HTML review contains stale or duplicate tag records`);
  }
  const ledger: PreallocationCapacityLedger = {
    schemaVersion: "jolene.personality-preallocation-capacity-ledger.v1",
    status: "independently-reviewed-before-allocation",
    sourceRegisterFingerprint: register.registerFingerprint,
    boundaryProtocolFingerprint: protocol.protocolFingerprint,
    highRiskTaxonomyFingerprint: protocol.highRiskTaxonomyFingerprint,
    sourceRegisterId: sourceId,
    sourceEventId: draft.sourceEventId,
    sourceContentFingerprint: draft.sourceContentFingerprint,
    boundaryManifestFingerprint: digest(draftText),
    ledgerFingerprintMapFingerprint: digest(mapText),
    policyAmendmentFingerprint: null,
    primaryReviewFingerprint: preflight.primaryReviewFingerprint,
    independentReviewFingerprint: preflight.independentReviewFingerprint,
    segmentationRule: draft.segmentationRule,
    sourceBoundaryUnitCount: draft.sourceBoundaryUnitCount,
    frozenAt: preflight.evidence.created_at,
    primaryReviewer: reviewer(primary),
    independentReviewer: reviewer(independent),
    eligibleUnits, excludedRanges,
    sourceContentStored: false,
    frozenBeforeAllocation: true,
    selectionPerformed: false,
    observationCodingPerformed: false,
    runtimeActivation: "prohibited",
  };
  summaries.push(validatePreallocationCapacityLedger(register, protocol, ledger));
  outputs.push({
    path: path.resolve(outputRoot, `source-${sourceId}.json`),
    text: `${JSON.stringify(ledger, null, 2)}\n`,
  });
}
await mkdir(outputRoot, { recursive: true });
for (const output of outputs) {
  const temporary = `${output.path}.${process.pid}.tmp`;
  await writeFile(temporary, output.text, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, output.path);
}
process.stdout.write(`${JSON.stringify({
  primaryReviewFingerprint: preflight.primaryReviewFingerprint,
  independentReviewFingerprint: preflight.independentReviewFingerprint,
  summaries,
}, null, 2)}\n`);

function tagsFor(report: z.infer<typeof reportSchema>, sourceId: z.infer<typeof sourceIdSchema>) {
  const entries = report.tagged_eligible_units.filter(
    (item) => item.source_register_id === sourceId,
  );
  return new Map<string, Array<z.infer<typeof strataSchema>>>(entries.map((item) => [
    `${item.locator}|${item.unit_fingerprint}`, [...item.high_risk_strata],
  ] as const));
}

function taggedCount(
  report: z.infer<typeof reportSchema>, sourceId: z.infer<typeof sourceIdSchema>,
) {
  return report.tagged_eligible_units.filter(
    (item) => item.source_register_id === sourceId,
  ).length;
}

function ambiguityKeys(
  report: z.infer<typeof reportSchema>, sourceId: z.infer<typeof sourceIdSchema>,
) {
  return report.ambiguous_units.filter((item) => item.source_register_id === sourceId)
    .map((item) => `${item.locator}|${item.unit_fingerprint}`);
}

function reviewer(report: z.infer<typeof reportSchema>) {
  return {
    reviewerId: report.reviewer.reviewer_id,
    reviewerType: "ai" as const,
    tool: report.reviewer.tool,
    modelVersion: typeof report.reviewer.model === "string" ? report.reviewer.model :
      report.reviewer.model.join(","),
    reviewedAt: report.reviewer.reviewed_at,
  };
}

function zeroTagCount(value: z.infer<typeof reportSchema>["zero_tag_attestation"]) {
  return "eligible_units" in value ? value.eligible_units : value.eligible_units_with_zero_tags;
}

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
