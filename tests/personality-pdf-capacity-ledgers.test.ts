import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  loadPersonalityPdfCapacityLedgersV1, mapPdfBoundaryExclusionReason,
} from "../src/personality/personality-pdf-capacity-ledgers.js";

describe("personality PDF capacity ledgers", () => {
  it("loads four independently reviewed metadata-only ledgers", async () => {
    const result = await loadPersonalityPdfCapacityLedgersV1();
    expect(result.ledgers.map((item) => [
      item.sourceRegisterId, item.boundaryUnits, item.eligibleUnits,
      item.agreedHighRiskUnits, item.uncertainHighRiskUnits,
    ])).toEqual([
      ["S04", 101, 45, 30, 1], ["S08", 199, 88, 56, 8],
      ["S09", 11, 5, 5, 0], ["S18", 19, 2, 1, 0],
    ]);
    expect(result).toMatchObject({
      sourceContentStored: false, selectionPerformed: false,
      observationCodingPerformed: false, runtimeActivation: "prohibited",
    });
  });

  it("covers every controlled exclusion conversion, including the unobserved cue-only branch", () => {
    expect([
      "prelabel-non-dialogue", "other-speaker", "performance-cue-whole-block",
      "cue-only-or-empty", "closed-set-fragment",
    ].map(mapPdfBoundaryExclusionReason)).toEqual([
      "not-atomic", "interviewer-or-other-speaker", "lyric-or-performance",
      "non-verbal", "too-fragmentary",
    ]);
    expect(() => mapPdfBoundaryExclusionReason("invented")).toThrow("Unknown PDF exclusion");
  });

  it("rejects removing an independently identified uncertainty", async () => {
    const root = await fixtureRoot();
    try {
      const file = path.resolve(root,
        "research/preallocation-capacity-ledgers-v1/source-S04.json");
      const ledger = JSON.parse(await readFile(file, "utf8"));
      const uncertain = ledger.eligibleUnits.find(
        (item: { highRiskReviewState: string }) =>
          item.highRiskReviewState === "uncertainty-withheld",
      );
      uncertain.highRiskReviewState = "consensus";
      uncertain.agreedHighRiskStrata = uncertain.primaryHighRiskStrata;
      uncertain.consensusWithheldHighRiskStrata = [];
      await writeFile(file, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
      await expect(loadPersonalityPdfCapacityLedgersV1(root)).rejects
        .toThrow(/eligible PDF capacity unit is stale/u);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function fixtureRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "jolene-pdf-capacity-ledgers-"));
  for (const directory of [
    "pdf-boundary-manifests-v1", "pdf-ledger-fingerprint-maps-v1",
    "preallocation-capacity-ledgers-v1",
  ]) await mkdir(path.resolve(root, "research", directory), { recursive: true });
  for (const file of [
    "allocation-capacity-audit-v1.yaml", "av-attribution-recovery-outcome-v1.yaml",
    "sampling-boundary-protocol-v1.yaml", "sampling-plan-v3-outcome.yaml",
    "sampling-plan-v3.yaml", "source-events-v2.yaml", "source-register-v3-repair.yaml",
    "sources.yaml", "pdf-cue-adjudication-audit-v1.yaml",
    "pdf-cue-adjudication-amendment-v1.yaml", "pdf-capacity-review-evidence-v1.yaml",
  ]) await copyFile(path.resolve("research", file), path.resolve(root, "research", file));
  for (const sourceId of ["S04", "S08", "S09", "S18"]) {
    for (const directory of [
      "pdf-boundary-manifests-v1", "pdf-ledger-fingerprint-maps-v1",
      "preallocation-capacity-ledgers-v1",
    ]) await copyFile(
      path.resolve("research", directory, `source-${sourceId}.json`),
      path.resolve(root, "research", directory, `source-${sourceId}.json`),
    );
  }
  return root;
}
