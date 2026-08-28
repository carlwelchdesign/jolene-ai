import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { loadPersonalityPdfBoundaryManifestsV1 } from
  "../src/personality/personality-pdf-boundary-manifests.js";

describe("personality PDF boundary manifests", () => {
  it("accepts all four complete metadata-only PDF boundaries", async () => {
    const result = await loadPersonalityPdfBoundaryManifestsV1();
    expect(result.manifests.map((item) => [
      item.sourceRegisterId, item.boundaryUnits, item.eligibleUnits,
    ])).toEqual([
      ["S04", 101, 45], ["S08", 199, 88], ["S09", 11, 5], ["S18", 19, 2],
    ]);
    expect(result.manifests.every((item) =>
      !item.sourceContentStored && !item.selectionPerformed &&
      item.runtimeActivation === "prohibited"
    )).toBe(true);
  });

  it("rejects missing boundary coverage", async () => {
    const root = await fixtureRoot();
    try {
      const file = path.resolve(root, "research/pdf-boundary-manifests-v1/source-S08.json");
      const manifest = JSON.parse(await readFile(file, "utf8"));
      manifest.units.splice(10, 1);
      await writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
      await expect(loadPersonalityPdfBoundaryManifestsV1(root)).rejects
        .toThrow(/counts or rule drifted|incomplete/u);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects persisted source content", async () => {
    const root = await fixtureRoot();
    try {
      const file = path.resolve(root, "research/pdf-boundary-manifests-v1/source-S18.json");
      const manifest = JSON.parse(await readFile(file, "utf8"));
      manifest.units[0].excerpt = "must never persist";
      await writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
      await expect(loadPersonalityPdfBoundaryManifestsV1(root)).rejects
        .toThrow("stores prohibited source content");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function fixtureRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "jolene-pdf-manifests-"));
  await mkdir(path.resolve(root, "research/pdf-boundary-manifests-v1"), { recursive: true });
  for (const file of [
    "allocation-capacity-audit-v1.yaml", "av-attribution-recovery-outcome-v1.yaml",
    "sampling-boundary-protocol-v1.yaml", "sampling-plan-v3-outcome.yaml",
    "sampling-plan-v3.yaml", "source-events-v2.yaml", "source-register-v3-repair.yaml",
    "sources.yaml", "pdf-cue-adjudication-audit-v1.yaml",
    "pdf-cue-adjudication-amendment-v1.yaml",
  ]) await copyFile(path.resolve("research", file), path.resolve(root, "research", file));
  for (const sourceId of ["S04", "S08", "S09", "S18"]) {
    await copyFile(
      path.resolve("research/pdf-boundary-manifests-v1", `source-${sourceId}.json`),
      path.resolve(root, "research/pdf-boundary-manifests-v1", `source-${sourceId}.json`),
    );
  }
  return root;
}
