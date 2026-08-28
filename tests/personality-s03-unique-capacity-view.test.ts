import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { loadS03UniqueCapacityView, s03UniqueCapacityViewSchema } from
  "../src/personality/personality-s03-unique-capacity-view.js";

describe("S03 unique capacity view", () => {
  it("freezes one deterministic representative per reviewed duplicate group", async () => {
    const view = await loadS03UniqueCapacityView();
    expect(view.counts).toEqual({
      sourceEligibleOccurrences: 270,
      uniqueCapacityUnits: 133,
      excludedDuplicateOccurrences: 137,
      consensusUnits: 70,
      uncertaintyWithheldUnits: 63,
      unitsWithAdmittedHighRiskStrata: 49,
    });
    expect(view.units).toHaveLength(133);
    expect(new Set(view.units.map((unit) => unit.segmentFingerprint))).toHaveLength(133);
    expect(view).toMatchObject({
      sourceContentStored: false,
      selectionPerformed: false,
      observationCodingPerformed: false,
      traitAdmission: "prohibited",
      runtimeActivation: "prohibited",
    });
  }, 15_000);

  it("rejects retaining labels for an uncertainty-withheld unit", async () => {
    const loaded = await loadS03UniqueCapacityView();
    const { viewFingerprint: _fingerprint, ...view } = loaded;
    const changed = structuredClone(view);
    const withheld = changed.units.find(
      (unit) => unit.highRiskReviewState === "uncertainty-withheld",
    )!;
    withheld.agreedHighRiskStrata = ["humor"];
    expect(s03UniqueCapacityViewSchema.safeParse(changed).success).toBe(false);
  }, 15_000);

  it("persists metadata only", async () => {
    const artifact = JSON.parse(await readFile(
      path.resolve("research/s03-unique-capacity-view-v1.json"), "utf8",
    ));
    const serialized = JSON.stringify(artifact);
    expect(serialized).not.toMatch(/"(?:sourceText|source_text|excerpt|quote|transcript|lyrics)"/u);
    expect(artifact.sourceContentStored).toBe(false);
  });
});
