import { describe, expect, it } from "vitest";

import { loadPersonalityHtmlCapacityLedgersV1 } from
  "../src/personality/personality-html-capacity-ledgers.js";

describe("personality HTML capacity ledgers", () => {
  it("loads six independently reviewed metadata-only ledgers", async () => {
    const result = await loadPersonalityHtmlCapacityLedgersV1();
    expect(result.ledgers.map((item) => [
      item.sourceRegisterId, item.boundaryUnits, item.eligibleUnits,
      item.agreedHighRiskUnits, item.uncertainHighRiskUnits,
    ])).toEqual([
      ["S02", 257, 43, 36, 0], ["S03", 543, 270, 166, 38],
      ["S05", 72, 29, 18, 1], ["S13", 61, 23, 20, 0],
      ["S19", 118, 58, 47, 2], ["S20", 25, 25, 10, 0],
    ]);
    expect(result).toMatchObject({
      sourceContentStored: false, selectionPerformed: false,
      observationCodingPerformed: false, runtimeActivation: "prohibited",
    });
  });
});
