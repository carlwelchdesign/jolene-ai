import { describe, expect, it } from "vitest";

import {
  PUBLIC_CHARACTER_GRAPH_FINGERPRINT,
  framePublicCharacterAnswer,
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

  it("frames grounded substance with a stable register-aware lead and close", () => {
    const first = framePublicCharacterAnswer(
      "Why should we hire Carl?",
      "Carl led frontend delivery and mentored engineers.",
    );
    const repeated = framePublicCharacterAnswer(
      "Why should we hire Carl?",
      "Carl led frontend delivery and mentored engineers.",
    );
    const skeptical = framePublicCharacterAnswer(
      "What should a skeptical manager verify?",
      "The portfolio does not establish every dimension of the role.",
    );

    expect(first).toBe(repeated);
    expect(first).toContain("Carl led frontend delivery and mentored engineers.");
    expect(first.split("\n\n")).toHaveLength(3);
    expect(skeptical).not.toBe(first);
    expect(skeptical).toMatch(/hard look|tiptoe|résumé varnish/iu);
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
