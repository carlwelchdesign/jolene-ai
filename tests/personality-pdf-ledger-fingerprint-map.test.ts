import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { loadPersonalityPdfLedgerFingerprintMapsV1 } from
  "../src/personality/personality-pdf-ledger-fingerprint-map.js";

describe("personality PDF ledger fingerprint maps", () => {
  it("binds every boundary unit to a distinct canonical ledger fingerprint", async () => {
    const result = await loadPersonalityPdfLedgerFingerprintMapsV1();
    expect(result.maps.map((item) => [item.sourceRegisterId, item.units])).toEqual([
      ["S04", 101], ["S08", 199], ["S09", 11], ["S18", 19],
    ]);
    expect(result.maps.every((item) =>
      !item.sourceContentStored && !item.selectionPerformed &&
      item.runtimeActivation === "prohibited"
    )).toBe(true);
  });

  it("rejects a map detached from its reviewed boundary unit", async () => {
    const root = await fixtureRoot();
    try {
      const file = path.resolve(root, "research/pdf-ledger-fingerprint-maps-v1/source-S09.json");
      const map = JSON.parse(await readFile(file, "utf8"));
      map.units[1].boundary_unit_fingerprint = `sha256:${"0".repeat(64)}`;
      await writeFile(file, `${JSON.stringify(map, null, 2)}\n`, "utf8");
      await expect(loadPersonalityPdfLedgerFingerprintMapsV1(root)).rejects
        .toThrow("conversion is incomplete or stale");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function fixtureRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "jolene-pdf-fingerprint-maps-"));
  await mkdir(path.resolve(root, "research/pdf-boundary-manifests-v1"), { recursive: true });
  await mkdir(path.resolve(root, "research/pdf-ledger-fingerprint-maps-v1"), { recursive: true });
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
    await copyFile(
      path.resolve("research/pdf-ledger-fingerprint-maps-v1", `source-${sourceId}.json`),
      path.resolve(root, "research/pdf-ledger-fingerprint-maps-v1", `source-${sourceId}.json`),
    );
  }
  return root;
}
