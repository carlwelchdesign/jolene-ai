import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { parse } from "yaml";
import { z } from "zod";

import { loadPersonalitySamplingOutcomeV3 } from "./personality-sampling-plan.js";
import { loadPersonalitySourceRegisterV2 } from "./personality-source-register.js";

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const optionalCountSchema = z.number().int().nonnegative().nullable();
const segmentationRuleSchema = z.enum([
  "cnn-speaker-label-blocks-v1", "indexed-caption-speaker-blocks-v1",
  "paragraph-speaker-blocks-v1", "pdf-speaker-label-blocks-v1",
  "pdf-attributed-statement-blocks-v1",
]);
const ruleGapSchema = z.enum([
  "explicit-speaker-label-unavailable", "fragment-threshold-unspecified",
  "mixed-content-handling-unspecified", "page-furniture-handling-unspecified",
  "paragraph-reconstruction-unspecified", "pdf-extractor-unspecified",
  "speaker-transition-map-unavailable",
]);

const capacitySourceSchema = z.object({
  source_register_id: z.string().regex(/^S\d{2}$/),
  source_event_id: z.string().regex(/^E\d{3}$/),
  content_fingerprint: sha256Schema,
  segmentation_rule: segmentationRuleSchema,
  result: z.enum([
    "sufficient-under-frozen-rule", "limited-under-frozen-rule",
    "zero-under-frozen-rule", "indeterminate-rule-insufficient",
  ]),
  input_segment_count: optionalCountSchema,
  boundary_unit_count: optionalCountSchema,
  target_eligible_count: optionalCountSchema,
  target_labeled_upper_bound: optionalCountSchema,
  high_risk_candidate_union_lower_bound: optionalCountSchema,
  rule_gaps: z.array(ruleGapSchema),
}).strict().superRefine((source, context) => {
  if (source.target_eligible_count !== null && source.target_labeled_upper_bound !== null &&
      source.target_eligible_count > source.target_labeled_upper_bound) {
    context.addIssue({ code: "custom", message: "Eligible count exceeds target-label bound" });
  }
  if (source.result === "sufficient-under-frozen-rule" ||
      source.result === "limited-under-frozen-rule") {
    if (source.boundary_unit_count === null || source.target_eligible_count === null ||
        source.high_risk_candidate_union_lower_bound === null || source.rule_gaps.length > 0) {
      context.addIssue({ code: "custom", message: "Determinate capacity is incomplete" });
    }
  }
  if (source.result === "zero-under-frozen-rule" &&
      (source.target_eligible_count !== 0 || source.high_risk_candidate_union_lower_bound !== 0 ||
       source.rule_gaps.length === 0)) {
    context.addIssue({ code: "custom", message: "Zero capacity must be explicit and explained" });
  }
  if (source.result === "indeterminate-rule-insufficient" && source.rule_gaps.length === 0) {
    context.addIssue({ code: "custom", message: "Indeterminate capacity requires a rule gap" });
  }
});

const capacityAuditSchema = z.object({
  schema_version: z.literal("personality-allocation-capacity-audit-v1"),
  status: z.literal("blocked-pending-protocol-and-register-repair"),
  audited_at: z.string().datetime(),
  source_register_fingerprint: sha256Schema,
  failed_sampling_plan_fingerprint: sha256Schema,
  source_content_stored: z.literal(false),
  selection_performed: z.literal(false),
  ledgers_created: z.literal(0),
  observations_created: z.literal(0),
  capacity_policy: z.object({
    target_speaker_attribution: z.literal("explicit-only"),
    ambiguous_capacity: z.literal("zero"),
    high_risk_counts: z.literal("conservative-screen-not-selection"),
    outcome_based_reallocation: z.literal("prohibited"),
  }).strict(),
  sources: z.array(capacitySourceSchema).length(11),
  required_repairs: z.tuple([
    z.literal("freeze-source-specific-extraction-and-boundary-rules"),
    z.literal("freeze-fragment-and-mixed-content-adjudication"),
    z.literal("freeze-reproducible-high-risk-tagging-protocol"),
    z.literal("reconcile-coding-ready-status-for-zero-capacity-sources"),
    z.literal("rerun-capacity-audit-before-v4"),
  ]),
  next_action: z.literal("prospective-protocol-and-source-register-repair"),
  runtime_activation: z.literal("prohibited"),
}).strict();

const failedPlanBindingSchema = z.object({
  schema_version: z.literal("personality-sampling-plan-v3"),
  created_at: z.string().datetime(),
  source_allocations: z.array(z.object({
    source_register_id: z.string().regex(/^S\d{2}$/),
    source_event_id: z.string().regex(/^E\d{3}$/),
    segmentation_rule: segmentationRuleSchema,
  }).passthrough()).length(11),
}).passthrough();

export async function loadPersonalitySamplingCapacityAuditV1(projectRoot = process.cwd()) {
  const [auditText, failedPlanText] = await Promise.all([
    readFile(path.resolve(
      projectRoot, "research", "allocation-capacity-audit-v1.yaml",
    ), "utf8"),
    readFile(path.resolve(projectRoot, "research", "sampling-plan-v3.yaml"), "utf8"),
  ]);
  const audit = capacityAuditSchema.parse(parse(auditText));
  const failedPlan = failedPlanBindingSchema.parse(parse(failedPlanText));
  const [register, failedOutcome] = await Promise.all([
    loadPersonalitySourceRegisterV2(projectRoot),
    loadPersonalitySamplingOutcomeV3(projectRoot),
  ]);
  if (audit.source_register_fingerprint !== register.registerFingerprint ||
      audit.failed_sampling_plan_fingerprint !== failedOutcome.sampling_plan_fingerprint ||
      audit.failed_sampling_plan_fingerprint !== digest(failedPlanText)) {
    throw new Error("Capacity audit snapshot is stale");
  }
  if (Date.parse(audit.audited_at) < Math.max(
    Date.parse(register.reviewedAt), Date.parse(failedOutcome.evaluated_at),
  )) {
    throw new Error("Capacity audit predates its register or failed-plan outcome");
  }
  const ready = register.events.filter((source) => source.accessState === "coding-ready");
  assertUnique(audit.sources.map((source) => source.source_register_id), "capacity source ID");
  assertUnique(audit.sources.map((source) => source.source_event_id), "capacity event ID");
  if (ready.length !== audit.sources.length) {
    throw new Error("Capacity audit must cover every coding-ready source exactly");
  }
  for (const source of ready) {
    const result = audit.sources.find(
      (candidate) => candidate.source_register_id === source.sourceRegisterId,
    );
    if (!result || result.source_event_id !== source.sourceEventId ||
        result.content_fingerprint !== source.sourceContentFingerprint) {
      throw new Error(`Capacity audit provenance mismatch for ${source.sourceRegisterId}`);
    }
  }
  for (const allocation of failedPlan.source_allocations) {
    const result = audit.sources.find(
      (candidate) => candidate.source_register_id === allocation.source_register_id,
    );
    if (!result || result.source_event_id !== allocation.source_event_id ||
        result.segmentation_rule !== allocation.segmentation_rule) {
      throw new Error(`Capacity audit rule mismatch for ${allocation.source_register_id}`);
    }
  }
  return {
    schemaVersion: "jolene.personality-allocation-capacity-audit.v1" as const,
    auditFingerprint: digest(auditText),
    status: audit.status,
    sourceRegisterFingerprint: audit.source_register_fingerprint,
    failedSamplingPlanFingerprint: audit.failed_sampling_plan_fingerprint,
    auditedSources: audit.sources.length,
    sufficientSources: audit.sources.filter(
      (source) => source.result === "sufficient-under-frozen-rule",
    ).length,
    limitedSources: audit.sources.filter(
      (source) => source.result === "limited-under-frozen-rule",
    ).length,
    zeroCapacitySources: audit.sources.filter(
      (source) => source.result === "zero-under-frozen-rule",
    ).map((source) => source.source_register_id),
    indeterminateSources: audit.sources.filter(
      (source) => source.result === "indeterminate-rule-insufficient",
    ).map((source) => source.source_register_id),
    selectionPerformed: audit.selection_performed,
    sourceContentStored: audit.source_content_stored,
    runtimeActivation: audit.runtime_activation,
    sources: audit.sources.map((source) => ({
      sourceRegisterId: source.source_register_id,
      result: source.result,
      segmentationRule: source.segmentation_rule,
      inputSegments: source.input_segment_count,
      boundaryUnits: source.boundary_unit_count,
      eligibleUnits: source.target_eligible_count,
      targetLabelUpperBound: source.target_labeled_upper_bound,
      highRiskCandidateLowerBound: source.high_risk_candidate_union_lower_bound,
      ruleGaps: source.rule_gaps,
    })),
  };
}

function assertUnique(values: readonly string[], label: string) {
  if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label}`);
}

function digest(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
