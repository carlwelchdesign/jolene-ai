import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { parse } from "yaml";
import { z } from "zod";

import { loadPersonalitySourceRegisterV2 } from "./personality-source-register.js";

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const sensitiveStratumSchema = z.enum([
  "belief", "biography", "boundary", "contradiction", "grief-or-hurt", "humor",
  "identity-trait", "politics", "voice-adjacent", "workplace-sexual-boundary",
]);
const exclusionReasonSchema = z.enum([
  "advertisement-or-promotion", "duplicate-or-overlap", "interviewer-or-other-speaker",
  "lyric-or-performance", "non-verbal", "not-atomic", "speaker-attribution-unclear",
  "too-fragmentary", "unreviewable-boundary",
]);

const sourceAllocationSchema = z.object({
  source_register_id: z.string().regex(/^S\d{2}$/),
  source_event_id: z.string().regex(/^E\d{3}$/),
  target_turns: z.number().int().positive(),
  systematic_turns: z.number().int().nonnegative(),
  purposive_high_risk_turns: z.number().int().nonnegative(),
  locator_unit: z.enum(["caption-index", "paragraph-index", "section-index", "timestamp"]),
  segmentation_rule: z.enum([
    "cnn-speaker-label-blocks-v1", "indexed-caption-speaker-blocks-v1",
    "paragraph-speaker-blocks-v1", "pdf-speaker-label-blocks-v1",
    "pdf-attributed-statement-blocks-v1", "vtt-speaker-cue-blocks-v1",
  ]),
}).superRefine((allocation, context) => {
  if (allocation.systematic_turns + allocation.purposive_high_risk_turns !==
      allocation.target_turns) {
    context.addIssue({ code: "custom", message: "Source allocation parts do not sum" });
  }
});

const samplingPlanSchema = z.object({
  schema_version: z.enum(["personality-sampling-plan-v2", "personality-sampling-plan-v3"]),
  status: z.literal("precommitted"),
  runtime_activation: z.literal("prohibited"),
  created_at: z.string().datetime(),
  source_register: z.object({
    schema_version: z.literal("jolene.personality-source-register.v2"),
    fingerprint: sha256Schema,
    reviewed_at: z.string().datetime(),
  }),
  target_atomic_turns: z.literal(120),
  selection_rules: z.object({
    systematic: z.object({
      rule_id: z.literal("SAM-001"),
      target_turns: z.literal(96),
      algorithm: z.literal("eligible-target-speaker-universe-even-midpoint-v1"),
      source_order: z.literal("publisher-boundary-order"),
      blind_to_trait_outcomes: z.literal(true),
    }),
    purposive_high_risk: z.object({
      rule_id: z.literal("SAM-002"),
      target_turns: z.literal(24),
      algorithm: z.literal("remaining-eligible-source-order-first-match-v1"),
      strata_priority: z.array(sensitiveStratumSchema).length(10),
      blind_to_fame_and_quotability: z.literal(true),
    }),
    selected_ids_immutable_after_ledger_freeze: z.literal(true),
    outcome_based_replacement: z.literal("prohibited"),
    failed_post_selection_gate: z.literal("requires-new-prospective-plan-version"),
  }),
  stratum_definitions: z.object({
    belief: z.literal("explicit religion spirituality or moral-conviction discussion"),
    biography: z.literal("personal history family health relationship or career-history account"),
    boundary: z.literal("explicit refusal limit condition correction or protected line"),
    contradiction: z.literal("explicit tension change counterevidence or competing claim"),
    "grief-or-hurt": z.literal("loss injury shame failure grief or described emotional pain"),
    humor: z.literal("observable joke wordplay self-deprecation comic reversal or laughter cue"),
    "identity-trait": z.literal("explicit self-description as a type of person or stable attribute"),
    politics: z.literal("policy elected office civic controversy or partisan positioning"),
    "voice-adjacent": z.literal("accent singing vocal sound or voice-performance discussion"),
    "workplace-sexual-boundary": z.literal("workplace conduct harassment sexualized treatment or appearance boundary"),
  }),
  eligibility: z.object({
    target_speaker_only: z.literal(true),
    atomic_turn_required: z.literal(true),
    coding_ready_source_required: z.literal(true),
    stable_locator_required: z.literal(true),
    source_segment_fingerprint_required: z.literal(true),
  }),
  exclusion_reasons: z.array(exclusionReasonSchema).length(9),
  balance_guards: z.object({
    minimum_source_events: z.literal(10),
    minimum_publisher_families: z.literal(8),
    minimum_setting_families: z.literal(8),
    minimum_time_bands: z.literal(4),
    maximum_source_share: z.literal(0.15),
    maximum_publisher_share: z.literal(0.20),
    maximum_time_band_share: z.literal(0.40),
  }),
  post_selection_acceptance: z.object({
    minimum_research_contexts: z.literal(8),
    minimum_turns_per_context: z.literal(5),
    minimum_sources_per_context: z.literal(2),
    minimum_rejected_trait_evidence_turns: z.literal(24),
    minimum_rejected_adaptation_turns: z.literal(24),
  }),
  source_allocations: z.array(sourceAllocationSchema).length(11),
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
  }),
  next_stage: z.object({
    independent_review: z.literal("required-separate-ticket"),
    trait_admission: z.literal("prohibited"),
    owner_decision: z.literal("not-requested"),
  }),
});

export type PersonalitySamplingPlan = z.infer<typeof samplingPlanSchema>;

export interface PersonalitySamplingPlanSnapshot {
  readonly schemaVersion:
    | "jolene.personality-sampling-plan.v2"
    | "jolene.personality-sampling-plan.v3";
  readonly planFingerprint: string;
  readonly createdAt: string;
  readonly sourceRegisterFingerprint: string;
  readonly sourceRegisterState: "current" | "superseded-after-recorded-failure";
  readonly targetAtomicTurns: number;
  readonly systematicTurns: number;
  readonly purposiveHighRiskTurns: number;
  readonly sourceEvents: number;
  readonly publisherFamilies: number;
  readonly settingFamilies: number;
  readonly timeBands: number;
  readonly runtimeActivation: "prohibited";
  readonly plan: PersonalitySamplingPlan;
}

export interface PersonalitySamplingPlanAudit {
  readonly schemaVersion:
    | "jolene.personality-sampling-plan.v2"
    | "jolene.personality-sampling-plan.v3";
  readonly planFingerprint: string;
  readonly createdAt: string;
  readonly sourceRegisterFingerprint: string;
  readonly sourceRegisterState:
    | "superseded-after-recorded-failure"
    | "current-at-recorded-failure";
  readonly targetAtomicTurns: number;
  readonly systematicTurns: number;
  readonly purposiveHighRiskTurns: number;
  readonly sourceEvents: number;
  readonly historicalDiversityMetricsRecomputed: false;
  readonly runtimeActivation: "prohibited";
}

const samplingOutcomeV2Schema = z.object({
  schema_version: z.literal("personality-sampling-outcome-v2"),
  status: z.literal("failed-before-selection-and-coding"),
  evaluated_at: z.string().datetime(),
  sampling_plan_fingerprint: sha256Schema,
  source_register_fingerprint: sha256Schema,
  failure: z.object({
    source_register_id: z.literal("S10"),
    source_event_id: z.literal("E009"),
    boundary_units_reviewed: z.literal(380),
    explicitly_attributed_target_turns: z.literal(0),
    code: z.literal("explicit-speaker-attribution-unavailable"),
  }),
  committed_selection_ledgers: z.literal(0),
  observations_created: z.literal(0),
  replacement_or_resampling_performed: z.literal(false),
  required_next_action: z.literal("new-prospective-source-register-and-sampling-plan-version"),
  runtime_activation: z.literal("prohibited"),
});

const samplingOutcomeV3Schema = z.object({
  schema_version: z.literal("personality-sampling-outcome-v3"),
  status: z.literal("failed-before-selection-and-coding"),
  evaluated_at: z.string().datetime(),
  sampling_plan_fingerprint: sha256Schema,
  source_register_fingerprint: sha256Schema,
  failure: z.object({
    source_register_id: z.literal("S09"),
    source_event_id: z.literal("E008"),
    boundary_units_reviewed: z.literal(11),
    explicitly_attributed_target_turns: z.literal(5),
    other_speaker_units: z.literal(5),
    preamble_or_non_dialogue_units: z.literal(1),
    required_target_turns: z.literal(8),
    required_systematic_turns: z.literal(6),
    required_purposive_high_risk_turns: z.literal(2),
    code: z.literal("allocated-turns-exceed-eligible-universe"),
  }),
  committed_selection_ledgers: z.literal(0),
  observations_created: z.literal(0),
  replacement_or_resampling_performed: z.literal(false),
  required_next_action: z.literal(
    "new-prospective-sampling-plan-version-after-capacity-audit",
  ),
  runtime_activation: z.literal("prohibited"),
});

const samplingOutcomeSchema = z.discriminatedUnion("schema_version", [
  samplingOutcomeV2Schema,
  samplingOutcomeV3Schema,
]);

export type PersonalitySamplingOutcome = z.infer<typeof samplingOutcomeSchema>;

export async function loadPersonalitySamplingPlanV2(
  projectRoot = process.cwd(),
): Promise<PersonalitySamplingPlanSnapshot> {
  return loadCurrentPersonalitySamplingPlan(projectRoot, 2);
}

export async function loadPersonalitySamplingPlanV3(
  projectRoot = process.cwd(),
): Promise<PersonalitySamplingPlanSnapshot> {
  return loadCurrentPersonalitySamplingPlan(projectRoot, 3);
}

async function loadCurrentPersonalitySamplingPlan(
  projectRoot: string,
  version: 2 | 3,
): Promise<PersonalitySamplingPlanSnapshot> {
  const planPath = path.resolve(projectRoot, "research", "sampling-plan-v2.yaml");
  const versionedPlanPath = version === 2 ? planPath : path.resolve(
    projectRoot, "research", "sampling-plan-v3.yaml",
  );
  const planText = await readFile(versionedPlanPath, "utf8");
  const plan = samplingPlanSchema.parse(parse(planText));
  if (plan.schema_version !== `personality-sampling-plan-v${version}`) {
    throw new Error(`Sampling plan file does not contain v${version}`);
  }
  if (version === 3) {
    await loadPersonalitySamplingOutcomeV3(projectRoot);
    throw new Error("Sampling plan has a recorded failure outcome");
  }
  const register = await loadPersonalitySourceRegisterV2(projectRoot);
  const registerIsCurrent = plan.source_register.fingerprint === register.registerFingerprint &&
    plan.source_register.reviewed_at === register.reviewedAt;
  if (!registerIsCurrent) {
    throw new Error("Sampling plan source-register snapshot is stale");
  }
  if (Date.parse(plan.created_at) < Date.parse(plan.source_register.reviewed_at)) {
    throw new Error("Sampling plan predates its source-register snapshot");
  }
  const ready = register.events.filter((source) => source.accessState === "coding-ready");
  const byRegisterId = new Map(ready.map((source) => [source.sourceRegisterId, source]));
  assertUnique(plan.source_allocations.map((allocation) => allocation.source_register_id),
    "sampling source register ID");
  assertUnique(plan.source_allocations.map((allocation) => allocation.source_event_id),
    "sampling source event ID");
  assertUnique(plan.selection_rules.purposive_high_risk.strata_priority,
    "high-risk stratum priority");
  assertUnique(plan.exclusion_reasons, "sampling exclusion reason");
  if (plan.source_allocations.length !== ready.length ||
      ready.some((source) => !plan.source_allocations.some(
        (allocation) => allocation.source_register_id === source.sourceRegisterId))) {
    throw new Error("Sampling plan must allocate every coding-ready source exactly once");
  }
  for (const allocation of plan.source_allocations) {
    const source = byRegisterId.get(allocation.source_register_id);
    if (!source || source.sourceEventId !== allocation.source_event_id) {
      throw new Error(`Sampling allocation provenance mismatch for ${allocation.source_register_id}`);
    }
  }
  assertSum(plan.source_allocations.map((allocation) => allocation.target_turns),
    plan.target_atomic_turns, "target turn allocation");
  assertSum(plan.source_allocations.map((allocation) => allocation.systematic_turns),
    plan.selection_rules.systematic.target_turns, "systematic allocation");
  assertSum(plan.source_allocations.map((allocation) => allocation.purposive_high_risk_turns),
    plan.selection_rules.purposive_high_risk.target_turns, "high-risk allocation");
  assertMaximumShare(plan.source_allocations.map((allocation) => ({
    key: allocation.source_event_id, count: allocation.target_turns,
  })), plan.target_atomic_turns, plan.balance_guards.maximum_source_share, "source event");
  const allocatedSources = plan.source_allocations.map(
    (allocation) => byRegisterId.get(allocation.source_register_id)!,
  );
  assertGroupedShare(plan.source_allocations, byRegisterId, plan.target_atomic_turns,
    (source) => source.publisherFamilyId, plan.balance_guards.maximum_publisher_share,
    "publisher family");
  assertGroupedShare(plan.source_allocations, byRegisterId, plan.target_atomic_turns,
    (source) => source.timeBand, plan.balance_guards.maximum_time_band_share, "time band");
  const publisherFamilies = new Set(allocatedSources.map((source) => source.publisherFamilyId)).size;
  const settingFamilies = new Set(allocatedSources.map((source) => source.settingFamily)).size;
  const timeBands = new Set(allocatedSources.map((source) => source.timeBand)).size;
  assertMinimum(allocatedSources.length, plan.balance_guards.minimum_source_events,
    "planned source events");
  assertMinimum(publisherFamilies, plan.balance_guards.minimum_publisher_families,
    "planned publisher families");
  assertMinimum(settingFamilies, plan.balance_guards.minimum_setting_families,
    "planned setting families");
  assertMinimum(timeBands, plan.balance_guards.minimum_time_bands, "planned time bands");
  return {
    schemaVersion: `jolene.personality-sampling-plan.v${version}`,
    planFingerprint: digest(planText),
    createdAt: plan.created_at,
    sourceRegisterFingerprint: plan.source_register.fingerprint,
    sourceRegisterState: "current",
    targetAtomicTurns: plan.target_atomic_turns,
    systematicTurns: plan.selection_rules.systematic.target_turns,
    purposiveHighRiskTurns: plan.selection_rules.purposive_high_risk.target_turns,
    sourceEvents: allocatedSources.length,
    publisherFamilies,
    settingFamilies,
    timeBands,
    runtimeActivation: plan.runtime_activation,
    plan,
  };
}

export async function loadPersonalitySamplingOutcomeV2(
  projectRoot = process.cwd(),
): Promise<PersonalitySamplingOutcome> {
  return loadPersonalitySamplingOutcome(projectRoot, 2);
}

export async function loadPersonalitySamplingOutcomeV3(
  projectRoot = process.cwd(),
): Promise<PersonalitySamplingOutcome> {
  return loadPersonalitySamplingOutcome(projectRoot, 3);
}

async function loadPersonalitySamplingOutcome(
  projectRoot: string,
  version: 2 | 3,
): Promise<PersonalitySamplingOutcome> {
  const [outcomeText, planText] = await Promise.all([
    readFile(path.resolve(
      projectRoot, "research", `sampling-plan-v${version}-outcome.yaml`,
    ), "utf8"),
    readFile(path.resolve(projectRoot, "research", `sampling-plan-v${version}.yaml`), "utf8"),
  ]);
  const outcome = samplingOutcomeSchema.parse(parse(outcomeText));
  const rawPlan = samplingPlanSchema.parse(parse(planText));
  if (outcome.schema_version !== `personality-sampling-outcome-v${version}` ||
      rawPlan.schema_version !== `personality-sampling-plan-v${version}`) {
    throw new Error(`Sampling outcome file does not contain v${version}`);
  }
  if (outcome.sampling_plan_fingerprint !== digest(planText) ||
      outcome.source_register_fingerprint !== rawPlan.source_register.fingerprint) {
    throw new Error("Sampling outcome does not match the frozen plan snapshot");
  }
  if (Date.parse(outcome.evaluated_at) < Date.parse(rawPlan.created_at)) {
    throw new Error("Sampling outcome predates the frozen plan");
  }
  return outcome;
}

export async function loadPersonalitySamplingAuditV2(
  projectRoot = process.cwd(),
): Promise<PersonalitySamplingPlanAudit> {
  return loadPersonalitySamplingAudit(projectRoot, 2);
}

export async function loadPersonalitySamplingAuditV3(
  projectRoot = process.cwd(),
): Promise<PersonalitySamplingPlanAudit> {
  return loadPersonalitySamplingAudit(projectRoot, 3);
}

async function loadPersonalitySamplingAudit(
  projectRoot: string,
  version: 2 | 3,
): Promise<PersonalitySamplingPlanAudit> {
  const planText = await readFile(
    path.resolve(projectRoot, "research", `sampling-plan-v${version}.yaml`), "utf8",
  );
  const plan = samplingPlanSchema.parse(parse(planText));
  if (plan.schema_version !== `personality-sampling-plan-v${version}`) {
    throw new Error(`Sampling plan file does not contain v${version}`);
  }
  await loadPersonalitySamplingOutcome(projectRoot, version);
  assertUnique(plan.source_allocations.map((allocation) => allocation.source_register_id),
    "sampling source register ID");
  assertUnique(plan.source_allocations.map((allocation) => allocation.source_event_id),
    "sampling source event ID");
  assertUnique(plan.selection_rules.purposive_high_risk.strata_priority,
    "high-risk stratum priority");
  assertUnique(plan.exclusion_reasons, "sampling exclusion reason");
  assertSum(plan.source_allocations.map((allocation) => allocation.target_turns),
    plan.target_atomic_turns, "target turn allocation");
  assertSum(plan.source_allocations.map((allocation) => allocation.systematic_turns),
    plan.selection_rules.systematic.target_turns, "systematic allocation");
  assertSum(plan.source_allocations.map((allocation) => allocation.purposive_high_risk_turns),
    plan.selection_rules.purposive_high_risk.target_turns, "high-risk allocation");
  if (Date.parse(plan.created_at) < Date.parse(plan.source_register.reviewed_at)) {
    throw new Error("Sampling plan predates its source-register snapshot");
  }
  return {
    schemaVersion: `jolene.personality-sampling-plan.v${version}`,
    planFingerprint: digest(planText),
    createdAt: plan.created_at,
    sourceRegisterFingerprint: plan.source_register.fingerprint,
    sourceRegisterState: version === 2
      ? "superseded-after-recorded-failure"
      : "current-at-recorded-failure",
    targetAtomicTurns: plan.target_atomic_turns,
    systematicTurns: plan.selection_rules.systematic.target_turns,
    purposiveHighRiskTurns: plan.selection_rules.purposive_high_risk.target_turns,
    sourceEvents: plan.source_allocations.length,
    historicalDiversityMetricsRecomputed: false,
    runtimeActivation: plan.runtime_activation,
  };
}

function assertSum(values: readonly number[], expected: number, label: string) {
  const actual = values.reduce((sum, value) => sum + value, 0);
  if (actual !== expected) throw new Error(`Invalid ${label}: ${actual} !== ${expected}`);
}

function assertMaximumShare(
  groups: readonly { readonly key: string; readonly count: number }[],
  total: number,
  maximum: number,
  label: string,
) {
  if (groups.some((group) => group.count / total > maximum)) {
    throw new Error(`Maximum planned ${label} share exceeded`);
  }
}

function assertGroupedShare(
  allocations: readonly z.infer<typeof sourceAllocationSchema>[],
  sources: ReadonlyMap<string, Awaited<ReturnType<typeof loadPersonalitySourceRegisterV2>>["events"][number]>,
  total: number,
  group: (source: Awaited<ReturnType<typeof loadPersonalitySourceRegisterV2>>["events"][number]) => string,
  maximum: number,
  label: string,
) {
  const counts = new Map<string, number>();
  for (const allocation of allocations) {
    const source = sources.get(allocation.source_register_id)!;
    const key = group(source);
    counts.set(key, (counts.get(key) ?? 0) + allocation.target_turns);
  }
  assertMaximumShare([...counts].map(([key, count]) => ({ key, count })), total, maximum, label);
}

function assertUnique(values: readonly string[], label: string) {
  if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label}`);
}

function assertMinimum(actual: number, minimum: number, label: string) {
  if (actual < minimum) throw new Error(`Too few ${label}: ${actual} < ${minimum}`);
}

function digest(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
