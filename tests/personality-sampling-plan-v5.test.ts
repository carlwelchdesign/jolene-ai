import { describe, expect, it } from "vitest";

import { loadPersonalitySamplingPlanV5, samplingPlanV5Schema } from
  "../src/personality/personality-sampling-plan-v5.js";

describe("personality sampling plan v5", () => {
  it("precommits 120 turns against the corrected unique capacity", async () => {
    const result = await loadPersonalitySamplingPlanV5();
    expect(result).toMatchObject({
      schemaVersion: "jolene.personality-sampling-plan.v5",
      targetAtomicTurns: 120,
      systematicTurns: 96,
      purposiveHighRiskTurns: 24,
      effectiveUniqueEligibleUnits: 451,
      selectionPerformed: false,
      observationCodingPerformed: false,
      runtimeActivation: "prohibited",
    });
    expect(result.plan.source_allocations.find(
      (allocation) => allocation.source_register_id === "S03",
    )).toMatchObject({
      eligible_capacity: 133,
      agreed_high_risk_capacity: 49,
      uncertain_high_risk_units: 63,
      target_turns: 14,
      systematic_turns: 8,
      purposive_high_risk_turns: 6,
      capacity_basis: "reviewed-unique-capacity-view",
    });
    expect(result.plan.selection_rules).toMatchObject({
      global_segment_fingerprint_uniqueness: "required-before-artifact-write",
      duplicate_detection_scope: "all-selected-turns-across-all-sources",
    });
  }, 20_000);

  it("rejects reverting S03 to occurrence capacity or weakening uniqueness", async () => {
    const loaded = await loadPersonalitySamplingPlanV5();
    const occurrenceCapacity = structuredClone(loaded.plan);
    occurrenceCapacity.source_allocations.find(
      (allocation) => allocation.source_register_id === "S03",
    )!.eligible_capacity = 270;
    expect(samplingPlanV5Schema.safeParse(occurrenceCapacity).success).toBe(false);

    const weak = structuredClone(loaded.plan) as Record<string, unknown>;
    (weak.selection_rules as Record<string, unknown>).global_segment_fingerprint_uniqueness =
      "best-effort";
    expect(samplingPlanV5Schema.safeParse(weak).success).toBe(false);
  }, 20_000);
});
