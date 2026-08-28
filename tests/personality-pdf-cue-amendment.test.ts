import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { parse, stringify } from "yaml";
import { describe, expect, it } from "vitest";

import { loadPersonalityPdfCueAdjudicationAmendmentV1 } from
  "../src/personality/personality-pdf-cue-amendment.js";

describe("personality PDF cue adjudication amendment", () => {
  it("accepts the prospective independently reviewed conservative rule", async () => {
    await expect(loadPersonalityPdfCueAdjudicationAmendmentV1()).resolves
      .toMatchObject({
        status: "prospective-reviewed-non-activating",
        ruleId: "pdf-cue-adjudication-conservative-v1",
        boundaryUnits: 101, targetSpeakerBlocks: 49,
        performanceExcludedTargetBlocks: 4, eligibleTargetBlocks: 45,
        reviewerCount: 2, sourceContentStored: false, selectionPerformed: false,
        runtimeActivation: "prohibited",
        amendmentFingerprint: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
        manifestFingerprint: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
      });
  });

  it("rejects reclassifying a performance-bearing block from residual payload", async () => {
    const root = await fixtureRoot();
    try {
      const manifestPath = path.resolve(
        root, "research", "pdf-boundary-manifests-v1", "source-S04.json",
      );
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      const performance = manifest.units.find((item: { cue_categories: string[] }) =>
        item.cue_categories.includes("performance")
      );
      performance.disposition = "eligible";
      performance.reason = "spoken-payload";
      performance.residual_token_count = 10;
      performance.fragment_result = "passed";
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
      await expect(loadPersonalityPdfCueAdjudicationAmendmentV1(root))
        .rejects.toThrow(/prerequisites are stale|disposition precedence/u);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects prohibited source content fields even when the manifest hash is updated", async () => {
    const root = await fixtureRoot();
    try {
      const manifestPath = path.resolve(
        root, "research", "pdf-boundary-manifests-v1", "source-S04.json",
      );
      const amendmentPath = path.resolve(
        root, "research", "pdf-cue-adjudication-amendment-v1.yaml",
      );
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      manifest.units[0].source_text = "must never persist";
      const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
      await writeFile(manifestPath, manifestText, "utf8");
      const amendment = parse(await readFile(amendmentPath, "utf8"));
      amendment.boundary_manifest_fingerprint = digest(manifestText);
      await writeFile(amendmentPath, stringify(amendment), "utf8");
      await expect(loadPersonalityPdfCueAdjudicationAmendmentV1(root))
        .rejects.toThrow("stores prohibited source content");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function fixtureRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "jolene-pdf-cue-amendment-"));
  await mkdir(path.resolve(root, "research", "pdf-boundary-manifests-v1"), {
    recursive: true,
  });
  for (const file of [
    "allocation-capacity-audit-v1.yaml", "av-attribution-recovery-outcome-v1.yaml",
    "sampling-boundary-protocol-v1.yaml", "sampling-plan-v3-outcome.yaml",
    "sampling-plan-v3.yaml", "source-events-v2.yaml", "source-register-v3-repair.yaml",
    "sources.yaml", "pdf-cue-adjudication-audit-v1.yaml",
    "pdf-cue-adjudication-amendment-v1.yaml",
  ]) {
    await copyFile(path.resolve("research", file), path.resolve(root, "research", file));
  }
  await copyFile(
    path.resolve("research", "pdf-boundary-manifests-v1", "source-S04.json"),
    path.resolve(root, "research", "pdf-boundary-manifests-v1", "source-S04.json"),
  );
  return root;
}

function digest(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
