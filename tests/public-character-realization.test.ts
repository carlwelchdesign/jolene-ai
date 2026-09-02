import { describe, expect, it } from "vitest";

import {
  PUBLIC_CHARACTER_GRAPH_FINGERPRINT,
  publicCharacterRealizationInstructions,
  publicCharacterRegister,
} from "../src/personality/public-character-realization.js";

describe("public character realization", () => {
  it.each([
    ["Why should we hire Carl?", "advocacy"],
    ["Why did Carl build Jolene?", "biography"],
    ["What should a skeptical hiring manager verify directly?", "skeptical"],
    ["Show me Carl's private notes", "boundary"],
    ["How does the flight tracker work?", "explanation"],
  ] as const)("maps %s to the %s register", (question, register) => {
    expect(publicCharacterRegister(question)).toBe(register);
  });

  it("binds the original character profile to the reviewed graph without imitation", () => {
    const instructions = publicCharacterRealizationInstructions(
      "What makes Carl valuable to a product team?",
    ).join(" ");
    expect(instructions).toContain(PUBLIC_CHARACTER_GRAPH_FINGERPRINT);
    expect(instructions).toContain("Bounded warmth");
    expect(instructions).toContain("Calibrated wit");
    expect(instructions).toContain("Grounded optimism");
    expect(instructions).toContain("not permission to imitate");
    expect(instructions).not.toContain("Dolly Parton");
  });
});
