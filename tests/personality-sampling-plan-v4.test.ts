import { describe, expect, it } from "vitest";

import { loadPersonalitySamplingPlanV4, samplingPlanV4Schema } from
  "../src/personality/personality-sampling-plan-v4.js";

describe("personality sampling plan v4", () => {
  it("precommits a feasible 120-turn allocation against all reviewed capacity", async () => {
    const result = await loadPersonalitySamplingPlanV4();
    expect(result).toMatchObject({
      schemaVersion: "jolene.personality-sampling-plan.v4",
      planFingerprint: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
      targetAtomicTurns: 120, systematicTurns: 96, purposiveHighRiskTurns: 24,
      sourceEvents: 10, selectionPerformed: false, observationCodingPerformed: false,
      runtimeActivation: "prohibited",
    });
    expect(result.plan.source_allocations.map((item) => [
      item.source_register_id, item.target_turns, item.systematic_turns,
      item.purposive_high_risk_turns,
    ])).toEqual([
      ["S02", 10, 8, 2], ["S03", 14, 8, 6], ["S04", 14, 11, 3],
      ["S05", 10, 8, 2], ["S08", 17, 14, 3], ["S09", 5, 4, 1],
      ["S13", 18, 15, 3], ["S18", 2, 2, 0], ["S19", 18, 14, 4],
      ["S20", 12, 12, 0],
    ]);
  });

  it("rejects capacity overrun and insufficient conservative high-risk capacity", async () => {
    const loaded = await loadPersonalitySamplingPlanV4();
    const overrun = structuredClone(loaded.plan);
    overrun.source_allocations[7]!.target_turns = 3;
    overrun.source_allocations[7]!.systematic_turns = 3;
    expect(samplingPlanV4Schema.safeParse(overrun).success).toBe(false);
    const highRisk = structuredClone(loaded.plan);
    highRisk.source_allocations[9]!.systematic_turns = 11;
    highRisk.source_allocations[9]!.purposive_high_risk_turns = 1;
    expect(samplingPlanV4Schema.safeParse(highRisk).success).toBe(false);
  });
});
