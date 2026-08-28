import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { parse, stringify } from "yaml";
import { describe, expect, it } from "vitest";

import { loadPersonalityPdfCueAdjudicationAuditV1 } from
  "../src/personality/personality-pdf-cue-audit.js";

describe("personality PDF cue adjudication audit", () => {
  it("records a metadata-only fail-closed protocol repair requirement", async () => {
    await expect(loadPersonalityPdfCueAdjudicationAuditV1()).resolves.toMatchObject({
      status: "protocol-repair-required-before-pdf-drafts",
      sourceRegisterId: "S04", sourceBoundaryUnits: 101, targetSpeakerBlocks: 49,
      frozenExpectedEligibleUnits: 48, literalEligibleOutcomes: [40, 45, 44, 49],
      testedLiteralPolicyMatchesFrozenCapacity: false,
      sourceContentStored: false, selectionPerformed: false, runtimeActivation: "prohibited",
      auditFingerprint: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    });
  });

  it("rejects arithmetic that fabricates the frozen capacity", async () => {
    const temporaryRoot = await fixtureRoot();
    try {
      const auditPath = path.resolve(
        temporaryRoot, "research", "pdf-cue-adjudication-audit-v1.yaml",
      );
      const audit = parse(await readFile(auditPath, "utf8"));
      audit.literal_policy_comparison.exclude_any_performance_block_only.eligible_units = 48;
      await writeFile(auditPath, stringify(audit), "utf8");
      await expect(loadPersonalityPdfCueAdjudicationAuditV1(temporaryRoot))
        .rejects.toThrow("policy arithmetic is invalid");
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });
});

async function fixtureRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "jolene-pdf-cue-audit-"));
  await mkdir(path.resolve(root, "research"));
  for (const file of [
    "allocation-capacity-audit-v1.yaml", "av-attribution-recovery-outcome-v1.yaml",
    "sampling-boundary-protocol-v1.yaml",
    "sampling-plan-v3-outcome.yaml", "sampling-plan-v3.yaml", "source-events-v2.yaml",
    "source-register-v3-repair.yaml",
    "sources.yaml",
    "pdf-cue-adjudication-audit-v1.yaml",
  ]) {
    await copyFile(
      path.resolve(process.cwd(), "research", file),
      path.resolve(root, "research", file),
    );
  }
  return root;
}
