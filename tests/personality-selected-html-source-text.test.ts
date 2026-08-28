import { describe, expect, it } from "vitest";

import { structuralHtmlPersonalityUnits } from
  "../src/personality/personality-selected-html-source-text.js";

describe("selected HTML personality source text", () => {
  it("preserves prompt/answer pairs as one transient S20 coding unit", () => {
    const segments = Array.from({ length: 50 }, (_, index) =>
      index % 2 === 0 ? `Question ${index / 2 + 1}` : `Answer ${(index + 1) / 2}`);
    const units = structuralHtmlPersonalityUnits("S20", segments);
    expect(units).toHaveLength(25);
    expect(units[3]).toEqual({
      segments: ["Question 4", "Answer 4"],
      locatorStart: 3,
      locatorEnd: 3,
      eligible: true,
    });
  });

  it("selects only explicitly attributed target paragraphs", () => {
    expect(structuralHtmlPersonalityUnits("S13", [
      "Adam Grant: A question.",
      "Dolly Parton: An answer.",
    ])).toEqual([
      { segments: ["Adam Grant: A question."], locatorStart: 0, locatorEnd: 0, eligible: false },
      { segments: ["Dolly Parton: An answer."], locatorStart: 1, locatorEnd: 1, eligible: true },
    ]);
  });
});
