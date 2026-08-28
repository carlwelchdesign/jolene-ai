import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { parse } from "yaml";
import { z } from "zod";

import { loadPersonalitySamplingPlanV4, samplingPlanV4Schema } from
  "./personality-sampling-plan-v4.js";
import { loadPersonalitySamplingPlanV4Outcome } from
  "./personality-sampling-plan-v4-outcome.js";
import { loadS03UniqueCapacityView } from
  "./personality-s03-unique-capacity-view.js";

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const baseAllocationSchema = samplingPlanV4Schema.shape.source_allocations.element;
const allocationSchema = baseAllocationSchema.extend({
  capacity_basis: z.enum(["reviewed-source-ledger", "reviewed-unique-capacity-view"]),
}).superRefine((allocation, context) => {
  if ((allocation.source_register_id === "S03") !==
      (allocation.capacity_basis === "reviewed-unique-capacity-view")) {
    context.addIssue({ code: "custom", message: "Source capacity basis is invalid" });
  }
  if (allocation.source_register_id === "S03" &&
      (allocation.eligible_capacity !== 133 ||
       allocation.agreed_high_risk_capacity !== 49 ||
       allocation.uncertain_high_risk_units !== 63)) {
    context.addIssue({ code: "custom", message: "S03 unique capacity is invalid" });
  }
});

export const samplingPlanV5Schema = samplingPlanV4Schema.omit({
  schema_version: true,
  status: true,
  created_at: true,
  capacity_manifest: true,
  selection_rules: true,
  source_allocations: true,
}).extend({
  schema_version: z.literal("personality-sampling-plan-v5"),
  status: z.literal("precommitted-against-reviewed-unique-capacity"),
  created_at: z.string().datetime(),
  predecessor: z.object({
    sampling_plan_v4_fingerprint: sha256Schema,
    failed_outcome_fingerprint: sha256Schema,
    failure_code: z.literal("duplicate-segment-fingerprints-in-candidate-selection"),
  }).strict(),
  capacity_manifest: samplingPlanV4Schema.shape.capacity_manifest.extend({
    source_eligible_occurrences: z.literal(588),
    effective_unique_eligible_units: z.literal(451),
  }).omit({ eligible_units: true }).strict(),
  s03_unique_capacity: z.object({
    schema_version: z.literal("jolene.personality-s03-unique-capacity-view.v1"),
    fingerprint: sha256Schema,
    frozen_at: z.string().datetime(),
    source_eligible_occurrences: z.literal(270),
    unique_capacity_units: z.literal(133),
    excluded_duplicate_occurrences: z.literal(137),
  }).strict(),
  selection_rules: z.object({
    systematic: z.object({
      rule_id: z.literal("SAM-001"),
      target_turns: z.literal(96),
      algorithm: z.literal("effective-eligible-universe-even-midpoint-v2"),
      source_order: z.literal("source-register-order"),
      blind_to_trait_outcomes: z.literal(true),
    }).strict(),
    purposive_high_risk: z.object({
      rule_id: z.literal("SAM-002"),
      target_turns: z.literal(24),
      algorithm: z.literal("remaining-effective-eligible-source-order-first-match-v2"),
      strata_priority:
        samplingPlanV4Schema.shape.selection_rules.shape.purposive_high_risk.shape.strata_priority,
      consensus_tags_only: z.literal(true),
      uncertainty_withheld_units_excluded: z.literal(true),
      blind_to_fame_and_quotability: z.literal(true),
    }).strict(),
    global_segment_fingerprint_uniqueness: z.literal("required-before-artifact-write"),
    duplicate_detection_scope: z.literal("all-selected-turns-across-all-sources"),
    selected_ids_immutable_after_ledger_freeze: z.literal(true),
    outcome_based_replacement: z.literal("prohibited"),
    failed_post_selection_gate: z.literal("requires-new-prospective-plan-version"),
  }).strict(),
  source_allocations: z.array(allocationSchema).length(10),
}).strict();

export type PersonalitySamplingPlanV5 = z.infer<typeof samplingPlanV5Schema>;

export async function buildPersonalitySamplingPlanV5(
  createdAt: string,
  projectRoot = process.cwd(),
): Promise<PersonalitySamplingPlanV5> {
  const [v4, outcome, unique] = await Promise.all([
    loadPersonalitySamplingPlanV4(projectRoot),
    loadPersonalitySamplingPlanV4Outcome(projectRoot),
    loadS03UniqueCapacityView(projectRoot),
  ]);
  if (Date.parse(createdAt) < Date.parse(unique.frozenAt)) {
    throw new Error("Sampling plan v5 predates the unique S03 capacity view");
  }
  const sourceAllocations = v4.plan.source_allocations.map((allocation) =>
    allocation.source_register_id === "S03" ? {
      ...allocation,
      eligible_capacity: unique.counts.uniqueCapacityUnits,
      agreed_high_risk_capacity: unique.counts.unitsWithAdmittedHighRiskStrata,
      uncertain_high_risk_units: unique.counts.uncertaintyWithheldUnits,
      capacity_basis: "reviewed-unique-capacity-view" as const,
    } : {
      ...allocation,
      capacity_basis: "reviewed-source-ledger" as const,
    }
  );
  return samplingPlanV5Schema.parse({
    ...v4.plan,
    schema_version: "personality-sampling-plan-v5",
    status: "precommitted-against-reviewed-unique-capacity",
    created_at: createdAt,
    predecessor: {
      sampling_plan_v4_fingerprint: v4.planFingerprint,
      failed_outcome_fingerprint: outcome.outcomeFingerprint,
      failure_code: outcome.failure.code,
    },
    capacity_manifest: {
      schema_version: v4.plan.capacity_manifest.schema_version,
      fingerprint: v4.plan.capacity_manifest.fingerprint,
      frozen_at: v4.plan.capacity_manifest.frozen_at,
      source_count: v4.plan.capacity_manifest.source_count,
      source_eligible_occurrences: v4.plan.capacity_manifest.eligible_units,
      effective_unique_eligible_units:
        v4.plan.capacity_manifest.eligible_units - unique.counts.excludedDuplicateOccurrences,
    },
    s03_unique_capacity: {
      schema_version: unique.schemaVersion,
      fingerprint: unique.viewFingerprint,
      frozen_at: unique.frozenAt,
      source_eligible_occurrences: unique.counts.sourceEligibleOccurrences,
      unique_capacity_units: unique.counts.uniqueCapacityUnits,
      excluded_duplicate_occurrences: unique.counts.excludedDuplicateOccurrences,
    },
    selection_rules: {
      systematic: {
        ...v4.plan.selection_rules.systematic,
        algorithm: "effective-eligible-universe-even-midpoint-v2",
      },
      purposive_high_risk: {
        ...v4.plan.selection_rules.purposive_high_risk,
        algorithm: "remaining-effective-eligible-source-order-first-match-v2",
      },
      global_segment_fingerprint_uniqueness: "required-before-artifact-write",
      duplicate_detection_scope: "all-selected-turns-across-all-sources",
      selected_ids_immutable_after_ledger_freeze: true,
      outcome_based_replacement: "prohibited",
      failed_post_selection_gate: "requires-new-prospective-plan-version",
    },
    source_allocations: sourceAllocations,
  });
}

export async function loadPersonalitySamplingPlanV5(projectRoot = process.cwd()) {
  const planText = await readFile(path.resolve(projectRoot, "research/sampling-plan-v5.yaml"), "utf8");
  const plan = samplingPlanV5Schema.parse(parse(planText));
  const expected = await buildPersonalitySamplingPlanV5(plan.created_at, projectRoot);
  if (JSON.stringify(plan) !== JSON.stringify(expected)) {
    throw new Error("Sampling plan v5 is stale or differs from reviewed unique capacity");
  }
  validateTotals(plan);
  return {
    schemaVersion: "jolene.personality-sampling-plan.v5" as const,
    planFingerprint: digest(planText),
    createdAt: plan.created_at,
    targetAtomicTurns: plan.target_atomic_turns,
    systematicTurns: plan.selection_rules.systematic.target_turns,
    purposiveHighRiskTurns: plan.selection_rules.purposive_high_risk.target_turns,
    effectiveUniqueEligibleUnits: plan.capacity_manifest.effective_unique_eligible_units,
    selectionPerformed: plan.selection_performed,
    observationCodingPerformed: plan.observation_coding_performed,
    runtimeActivation: plan.runtime_activation,
    plan,
  };
}

function validateTotals(plan: PersonalitySamplingPlanV5): void {
  const allocations = plan.source_allocations;
  const sum = (key: "target_turns" | "systematic_turns" | "purposive_high_risk_turns") =>
    allocations.reduce((total, allocation) => total + allocation[key], 0);
  if (new Set(allocations.map((allocation) => allocation.source_register_id)).size !== 10 ||
      sum("target_turns") !== 120 || sum("systematic_turns") !== 96 ||
      sum("purposive_high_risk_turns") !== 24 ||
      allocations.some((allocation) => allocation.target_turns / 120 > 0.15)) {
    throw new Error("Sampling plan v5 allocation totals or source balance are invalid");
  }
}

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
