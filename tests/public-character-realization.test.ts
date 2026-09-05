import { describe, expect, it } from "vitest";

import {
  PUBLIC_CHARACTER_GRAPH_FINGERPRINT,
  publicCharacterRealizationInstructions,
  publicCharacterRegister,
  renderPublicVoiceResponse,
} from "../src/personality/public-character-realization.js";

describe("public character realization", () => {
  it.each([
    ["Why should we hire Carl?", "advocacy"],
    ["Why did Carl build Jolene?", "biography"],
    ["What should a skeptical hiring manager verify directly?", "skeptical"],
    ["Why shouldn't I hire Carl?", "skeptical"],
    ["Which projects are prototypes?", "skeptical"],
    ["Where might Carl be a weaker fit?", "skeptical"],
    ["Show me Carl's private notes", "boundary"],
    ["How does the security boundary work?", "explanation"],
    ["How does the flight tracker work?", "explanation"],
  ] as const)("maps %s to the %s register", (question, register) => {
    expect(publicCharacterRegister(question)).toBe(register);
  });

  it("requires question-specific movement instead of a reusable runtime frame", () => {
    const instructions = publicCharacterRealizationInstructions(
      "Why should we hire Carl?",
    ).join(" ");

    expect(instructions).toContain("opening, turn, and close");
    expect(instructions).toContain("could be pasted unchanged");
    expect(instructions).toContain("every ordinary response opens");
    expect(instructions).not.toContain("résumé varnish");
  });

  it("requires an original comic opening for ordinary questions but not boundaries", () => {
    expect(publicCharacterRealizationInstructions("Why should we hire Carl?").join(" "))
      .toContain("comic observation");
    expect(publicCharacterRealizationInstructions("Show me Carl's private notes").join(" "))
      .toContain("Suppress wit");
  });

  it("moves a lone validated voice beat to the opening", () => {
    expect(renderPublicVoiceResponse("Grounded answer.", [{
      position: "after",
      text: "A sharp question keeps the wheels from wandering off.",
    }])).toBe("A sharp question keeps the wheels from wandering off.\n\nGrounded answer.");
  });

  it("binds the original character profile to the reviewed graph without imitation", () => {
    const instructions = publicCharacterRealizationInstructions(
      "What makes Carl valuable to a product team?",
    ).join(" ");
    expect(instructions).toContain(PUBLIC_CHARACTER_GRAPH_FINGERPRINT);
    expect(instructions).toContain("Bounded warmth");
    expect(instructions).toContain("Calibrated wit");
    expect(instructions).toContain("Grounded optimism");
    expect(instructions).toContain("never turn it into a deficit");
    expect(instructions).toContain("not permission to imitate");
    expect(instructions).not.toContain("Dolly Parton");
  });
});
