import { describe, expect, it } from "vitest";

import suite from "../evaluations/public-voice-lab-v1.json" with { type: "json" };
import { publicVoiceLabSuiteSchema } from "../src/evaluation/public-voice-lab-evaluation.js";

describe("public voice lab suite", () => {
  it("keeps thirty public-safe cases across the required conversational registers", () => {
    const parsed = publicVoiceLabSuiteSchema.parse(suite);
    expect(parsed.cases).toHaveLength(30);
    expect(parsed.reviewDimensions).toEqual([
      "grounding",
      "usefulness",
      "originality",
      "emotional_calibration",
      "conversational_aliveness",
      "restraint",
    ]);
    expect(new Set(parsed.cases.map((item) => item.register))).toEqual(
      new Set(["advocacy", "biography", "boundary", "explanation", "skeptical"]),
    );
  });
});
