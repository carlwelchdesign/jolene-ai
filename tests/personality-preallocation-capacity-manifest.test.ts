import { describe, expect, it } from "vitest";

import { loadPersonalityPreallocationCapacityManifestV1 } from
  "../src/personality/personality-preallocation-capacity-manifest.js";
import { preallocationCapacityManifestSchema } from
  "../src/personality/personality-preallocation-capacity-manifest.js";

describe("personality preallocation capacity manifest", () => {
  it("binds all ten coding-ready sources before allocation", async () => {
    const result = await loadPersonalityPreallocationCapacityManifestV1();
    expect(result.ledgers.map((entry) => entry.sourceRegisterId)).toEqual([
      "S02", "S03", "S04", "S05", "S08", "S09", "S13", "S18", "S19", "S20",
    ]);
    expect(result.totals).toEqual({
      sources: 10, boundaryUnits: 1406, eligibleUnits: 588, excludedUnits: 818,
      excludedRanges: 695, agreedHighRiskUnits: 389, uncertainHighRiskUnits: 50,
    });
    expect(result).toMatchObject({
      sourceContentStored: false, frozenBeforeAllocation: true,
      selectionPerformed: false, observationCodingPerformed: false,
      traitAdmission: "prohibited", runtimeActivation: "prohibited",
      manifestFingerprint: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
    });
  });

  it("rejects duplicate sources and self-inconsistent totals", async () => {
    const loaded = await loadPersonalityPreallocationCapacityManifestV1();
    const { manifestFingerprint: _fingerprint, ...manifest } = loaded;
    const duplicate = structuredClone(manifest);
    duplicate.ledgers[1] = duplicate.ledgers[0]!;
    expect(preallocationCapacityManifestSchema.safeParse(duplicate).success).toBe(false);
    const wrongTotal = structuredClone(manifest);
    wrongTotal.totals.eligibleUnits += 1;
    expect(preallocationCapacityManifestSchema.safeParse(wrongTotal).success).toBe(false);
  });
});
