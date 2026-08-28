import { describe, expect, it } from "vitest";

import { longestConsecutiveWordOverlap } from
  "../src/personality/personality-primary-coding-rights-v5.js";

describe("personality primary coding rights v5", () => {
  it("detects recognizable consecutive source expression", () => {
    expect(longestConsecutiveWordOverlap(
      "A safe paraphrase then repeats one two three four five six seven eight.",
      "The source says one two three four five six seven eight before continuing.",
    )).toBe(8);
  });

  it("does not treat scattered shared words as copied expression", () => {
    expect(longestConsecutiveWordOverlap(
      "The speaker gives credit and sets a practical boundary.",
      "Credit appears elsewhere while a boundary is explained in another sentence.",
    )).toBeLessThan(3);
  });
});
