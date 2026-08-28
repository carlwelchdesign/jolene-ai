import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { parse } from "yaml";
import { z } from "zod";

import { loadPersonalityPreallocationCapacityManifestV1 } from
  "./personality-preallocation-capacity-manifest.js";
import { loadPersonalitySourceRegisterV3 } from "./personality-source-register-v3.js";

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const sourceIdSchema = z.enum([
  "S02", "S03", "S04", "S05", "S08", "S09", "S13", "S18", "S19", "S20",
]);
const highRiskSchema = z.enum([
  "belief", "biography", "boundary", "contradiction", "grief-or-hurt", "humor",
  "identity-trait", "politics", "voice-adjacent", "workplace-sexual-boundary",
]);
const locatorSchema = z.enum([
  "paragraph-index", "speaker-block-index", "pair-index",
]);
const segmentationSchema = z.enum([
  "cnn-speaker-label-blocks-v1", "interview-speaker-label-blocks-v1",
  "paragraph-speaker-blocks-v1", "pdf-attributed-statement-blocks-v2",
  "pdf-speaker-label-blocks-v2", "vanity-proust-answer-pairs-v1",
]);
const allocationSchema = z.object({
  source_register_id: sourceIdSchema,
  source_event_id: z.string().regex(/^E\d{3}$/u),
  eligible_capacity: z.number().int().positive(),
  agreed_high_risk_capacity: z.number().int().nonnegative(),
  uncertain_high_risk_units: z.number().int().nonnegative(),
  target_turns: z.number().int().positive(),
  systematic_turns: z.number().int().nonnegative(),
  purposive_high_risk_turns: z.number().int().nonnegative(),
  locator_unit: locatorSchema,
  segmentation_rule: segmentationSchema,
}).strict().superRefine((allocation, context) => {
  if (allocation.systematic_turns + allocation.purposive_high_risk_turns !==
      allocation.target_turns) {
    context.addIssue({ code: "custom", message: "Source allocation parts do not sum" });
  }
  if (allocation.target_turns > allocation.eligible_capacity) {
    context.addIssue({ code: "custom", message: "Source allocation exceeds eligible capacity" });
  }
  if (allocation.purposive_high_risk_turns > Math.max(
    0, allocation.agreed_high_risk_capacity - allocation.systematic_turns,
  )) {
    context.addIssue({
      code: "custom", message: "High-risk allocation fails conservative capacity bound",
    });
  }
});

export const samplingPlanV4Schema = z.object({
  schema_version: z.literal("personality-sampling-plan-v4"),
  status: z.literal("precommitted-against-reviewed-capacity"),
  created_at: z.string().datetime(),
  source_register: z.object({
    schema_version: z.literal("jolene.personality-source-register.v3"),
    fingerprint: sha256Schema,
    reviewed_at: z.string().datetime(),
  }).strict(),
  capacity_manifest: z.object({
    schema_version: z.literal("jolene.personality-preallocation-capacity-manifest.v1"),
    fingerprint: sha256Schema,
    frozen_at: z.string().datetime(),
    source_count: z.literal(10),
    eligible_units: z.literal(588),
  }).strict(),
  target_atomic_turns: z.literal(120),
  selection_rules: z.object({
    systematic: z.object({
      rule_id: z.literal("SAM-001"),
      target_turns: z.literal(96),
      algorithm: z.literal("eligible-target-speaker-universe-even-midpoint-v1"),
      source_order: z.literal("source-register-order"),
      blind_to_trait_outcomes: z.literal(true),
    }).strict(),
    purposive_high_risk: z.object({
      rule_id: z.literal("SAM-002"),
      target_turns: z.literal(24),
      algorithm: z.literal("remaining-eligible-source-order-first-match-v1"),
      strata_priority: z.array(highRiskSchema).length(10),
      consensus_tags_only: z.literal(true),
      uncertainty_withheld_units_excluded: z.literal(true),
      blind_to_fame_and_quotability: z.literal(true),
    }).strict(),
    selected_ids_immutable_after_ledger_freeze: z.literal(true),
    outcome_based_replacement: z.literal("prohibited"),
    failed_post_selection_gate: z.literal("requires-new-prospective-plan-version"),
  }).strict(),
  balance_guards: z.object({
    minimum_source_events: z.literal(10),
    minimum_publisher_families: z.literal(8),
    minimum_setting_families: z.literal(8),
    minimum_time_bands: z.literal(4),
    maximum_source_share: z.literal(0.15),
    maximum_publisher_share: z.literal(0.20),
    maximum_time_band_share: z.literal(0.40),
  }).strict(),
  post_selection_acceptance: z.object({
    minimum_research_contexts: z.literal(8),
    minimum_turns_per_context: z.literal(5),
    minimum_sources_per_context: z.literal(2),
    minimum_rejected_trait_evidence_turns: z.literal(24),
    minimum_rejected_adaptation_turns: z.literal(24),
  }).strict(),
  source_allocations: z.array(allocationSchema).length(10),
  rights: z.object({
    repository_storage: z.literal("metadata-and-paraphrase-only"),
    excerpts: z.literal("prohibited"),
    lyrics: z.literal("prohibited"),
    transcript_audio_video_storage: z.literal("prohibited"),
    recognizable_expression: z.literal("prohibited"),
    biography_or_belief_transfer: z.literal("prohibited"),
    dialect_imitation: z.literal("prohibited"),
    default_intimacy: z.literal("prohibited"),
    voice_imitation: z.literal("prohibited"),
  }).strict(),
  selection_performed: z.literal(false),
  observation_coding_performed: z.literal(false),
  trait_admission: z.literal("prohibited"),
  runtime_activation: z.literal("prohibited"),
  next_stage: z.object({
    selection_ledger_generation: z.literal("required-separate-subtask"),
    independent_review: z.literal("required-after-primary-coding"),
  }).strict(),
}).strict();

export type PersonalitySamplingPlanV4 = z.infer<typeof samplingPlanV4Schema>;

const proposedAllocations = [
  ["S02", 10, 8, 2], ["S03", 14, 8, 6], ["S04", 14, 11, 3],
  ["S05", 10, 8, 2], ["S08", 17, 14, 3], ["S09", 5, 4, 1],
  ["S13", 18, 15, 3], ["S18", 2, 2, 0], ["S19", 18, 14, 4],
  ["S20", 12, 12, 0],
] as const;

export async function buildPersonalitySamplingPlanV4(
  createdAt: string,
  projectRoot = process.cwd(),
): Promise<PersonalitySamplingPlanV4> {
  const [register, capacity] = await Promise.all([
    loadPersonalitySourceRegisterV3(projectRoot),
    loadPersonalityPreallocationCapacityManifestV1(projectRoot),
  ]);
  const sources = new Map(register.events.map((event) => [event.sourceRegisterId, event]));
  const capacities = new Map(capacity.ledgers.map((entry) => [entry.sourceRegisterId, entry]));
  const sourceAllocations = proposedAllocations.map(
    ([sourceId, target, systematic, purposive]) => {
      const source = sources.get(sourceId);
      const available = capacities.get(sourceId);
      if (!source || source.accessState !== "coding-ready" || !available) {
        throw new Error(`${sourceId} lacks reviewed sampling capacity`);
      }
      return {
        source_register_id: sourceId,
        source_event_id: source.sourceEventId,
        eligible_capacity: available.eligibleUnits,
        agreed_high_risk_capacity: available.agreedHighRiskUnits,
        uncertain_high_risk_units: available.uncertainHighRiskUnits,
        target_turns: target,
        systematic_turns: systematic,
        purposive_high_risk_turns: purposive,
        locator_unit: locatorFor(sourceId),
        segmentation_rule: segmentationFor(sourceId),
      };
    },
  );
  return samplingPlanV4Schema.parse({
    schema_version: "personality-sampling-plan-v4",
    status: "precommitted-against-reviewed-capacity",
    created_at: createdAt,
    source_register: {
      schema_version: "jolene.personality-source-register.v3",
      fingerprint: register.registerFingerprint,
      reviewed_at: register.reviewedAt,
    },
    capacity_manifest: {
      schema_version: capacity.schemaVersion,
      fingerprint: capacity.manifestFingerprint,
      frozen_at: capacity.frozenAt,
      source_count: capacity.totals.sources,
      eligible_units: capacity.totals.eligibleUnits,
    },
    target_atomic_turns: 120,
    selection_rules: {
      systematic: {
        rule_id: "SAM-001", target_turns: 96,
        algorithm: "eligible-target-speaker-universe-even-midpoint-v1",
        source_order: "source-register-order", blind_to_trait_outcomes: true,
      },
      purposive_high_risk: {
        rule_id: "SAM-002", target_turns: 24,
        algorithm: "remaining-eligible-source-order-first-match-v1",
        strata_priority: [
          "boundary", "contradiction", "grief-or-hurt", "humor",
          "workplace-sexual-boundary", "voice-adjacent", "identity-trait",
          "politics", "belief", "biography",
        ],
        consensus_tags_only: true, uncertainty_withheld_units_excluded: true,
        blind_to_fame_and_quotability: true,
      },
      selected_ids_immutable_after_ledger_freeze: true,
      outcome_based_replacement: "prohibited",
      failed_post_selection_gate: "requires-new-prospective-plan-version",
    },
    balance_guards: {
      minimum_source_events: 10, minimum_publisher_families: 8,
      minimum_setting_families: 8, minimum_time_bands: 4,
      maximum_source_share: 0.15, maximum_publisher_share: 0.20,
      maximum_time_band_share: 0.40,
    },
    post_selection_acceptance: {
      minimum_research_contexts: 8, minimum_turns_per_context: 5,
      minimum_sources_per_context: 2, minimum_rejected_trait_evidence_turns: 24,
      minimum_rejected_adaptation_turns: 24,
    },
    source_allocations: sourceAllocations,
    rights: {
      repository_storage: "metadata-and-paraphrase-only", excerpts: "prohibited",
      lyrics: "prohibited", transcript_audio_video_storage: "prohibited",
      recognizable_expression: "prohibited", biography_or_belief_transfer: "prohibited",
      dialect_imitation: "prohibited", default_intimacy: "prohibited",
      voice_imitation: "prohibited",
    },
    selection_performed: false, observation_coding_performed: false,
    trait_admission: "prohibited", runtime_activation: "prohibited",
    next_stage: {
      selection_ledger_generation: "required-separate-subtask",
      independent_review: "required-after-primary-coding",
    },
  });
}

export async function loadPersonalitySamplingPlanV4(projectRoot = process.cwd()) {
  const planText = await readFile(path.resolve(
    projectRoot, "research/sampling-plan-v4.yaml",
  ), "utf8");
  const plan = samplingPlanV4Schema.parse(parse(planText));
  const expected = await buildPersonalitySamplingPlanV4(plan.created_at, projectRoot);
  if (JSON.stringify(plan) !== JSON.stringify(expected)) {
    throw new Error("Sampling plan v4 is stale or differs from the reviewed capacity allocation");
  }
  validatePlanTotalsAndBalance(plan, await loadPersonalitySourceRegisterV3(projectRoot));
  return {
    schemaVersion: "jolene.personality-sampling-plan.v4" as const,
    planFingerprint: digest(planText),
    createdAt: plan.created_at,
    capacityManifestFingerprint: plan.capacity_manifest.fingerprint,
    targetAtomicTurns: plan.target_atomic_turns,
    systematicTurns: plan.selection_rules.systematic.target_turns,
    purposiveHighRiskTurns: plan.selection_rules.purposive_high_risk.target_turns,
    sourceEvents: plan.source_allocations.length,
    selectionPerformed: plan.selection_performed,
    observationCodingPerformed: plan.observation_coding_performed,
    runtimeActivation: plan.runtime_activation,
    plan,
  };
}

function validatePlanTotalsAndBalance(
  plan: PersonalitySamplingPlanV4,
  register: Awaited<ReturnType<typeof loadPersonalitySourceRegisterV3>>,
) {
  const allocations = plan.source_allocations;
  assertUnique(allocations.map((item) => item.source_register_id), "source allocation");
  assertSum(allocations.map((item) => item.target_turns), 120, "target allocation");
  assertSum(allocations.map((item) => item.systematic_turns), 96, "systematic allocation");
  assertSum(allocations.map((item) => item.purposive_high_risk_turns), 24,
    "high-risk allocation");
  if (allocations.some((item) => item.target_turns / 120 > 0.15)) {
    throw new Error("Maximum planned source share exceeded");
  }
  const byId = new Map(register.events.map((event) => [event.sourceRegisterId, event]));
  assertGroupedShare(allocations, byId, (source) => source.publisherFamilyId, 0.20,
    "publisher family");
  assertGroupedShare(allocations, byId, (source) => source.timeBand, 0.40, "time band");
  const selectedSources = allocations.map((item) => byId.get(item.source_register_id)!);
  if (new Set(selectedSources.map((source) => source.publisherFamilyId)).size < 8 ||
      new Set(selectedSources.map((source) => source.settingFamily)).size < 8 ||
      new Set(selectedSources.map((source) => source.timeBand)).size < 4) {
    throw new Error("Sampling plan diversity floor is not met");
  }
}

function assertGroupedShare(
  allocations: PersonalitySamplingPlanV4["source_allocations"],
  sources: ReadonlyMap<string, Awaited<ReturnType<typeof loadPersonalitySourceRegisterV3>>["events"][number]>,
  group: (source: Awaited<ReturnType<typeof loadPersonalitySourceRegisterV3>>["events"][number]) => string,
  maximum: number,
  label: string,
) {
  const totals = new Map<string, number>();
  for (const allocation of allocations) {
    const source = sources.get(allocation.source_register_id);
    if (!source) throw new Error(`${allocation.source_register_id} source is missing`);
    const key = group(source);
    totals.set(key, (totals.get(key) ?? 0) + allocation.target_turns);
  }
  if ([...totals.values()].some((total) => total / 120 > maximum)) {
    throw new Error(`Maximum planned ${label} share exceeded`);
  }
}

function locatorFor(sourceId: z.infer<typeof sourceIdSchema>): z.infer<typeof locatorSchema> {
  if (["S03", "S04", "S08", "S09", "S19"].includes(sourceId)) {
    return "speaker-block-index";
  }
  return sourceId === "S20" ? "pair-index" : "paragraph-index";
}

function segmentationFor(sourceId: z.infer<typeof sourceIdSchema>): z.infer<typeof segmentationSchema> {
  if (["S04", "S08", "S09"].includes(sourceId)) return "pdf-speaker-label-blocks-v2";
  if (sourceId === "S18") return "pdf-attributed-statement-blocks-v2";
  if (sourceId === "S03") return "cnn-speaker-label-blocks-v1";
  if (sourceId === "S19") return "interview-speaker-label-blocks-v1";
  if (sourceId === "S20") return "vanity-proust-answer-pairs-v1";
  return "paragraph-speaker-blocks-v1";
}

function assertSum(values: readonly number[], expected: number, label: string) {
  const actual = values.reduce((sum, value) => sum + value, 0);
  if (actual !== expected) throw new Error(`Invalid ${label}: ${actual} !== ${expected}`);
}

function assertUnique(values: readonly string[], label: string) {
  if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label}`);
}

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
