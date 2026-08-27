import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { parse, stringify } from "yaml";
import { describe, expect, it } from "vitest";

import { validatePersonalitySamplingCapacityAudit } from
  "../scripts/validate-personality-sampling-capacity-audit.js";

describe("personality sampling allocation-capacity audit", () => {
  it("blocks v4 until deterministic protocol and source-register repairs exist", async () => {
    const result = await validatePersonalitySamplingCapacityAudit();
    expect(result).toMatchObject({
      schemaVersion: "jolene.personality-allocation-capacity-audit.v1",
      auditFingerprint: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      status: "blocked-pending-protocol-and-register-repair",
      auditedSources: 11,
      sufficientSources: 4,
      limitedSources: 1,
      zeroCapacitySources: ["S07", "S16", "S17"],
      indeterminateSources: ["S04", "S08", "S18"],
      selectionPerformed: false,
      sourceContentStored: false,
      runtimeActivation: "prohibited",
    });
    expect(result.sources.map((source) => [
      source.sourceRegisterId, source.result, source.segmentationRule,
      source.inputSegments, source.boundaryUnits, source.eligibleUnits,
      source.targetLabelUpperBound, source.highRiskCandidateLowerBound,
    ])).toEqual([
      ["S02", "sufficient-under-frozen-rule", "paragraph-speaker-blocks-v1", 257, 257, 43, 43, 36],
      ["S03", "sufficient-under-frozen-rule", "cnn-speaker-label-blocks-v1", 721, 543, 270, 270, 166],
      ["S04", "indeterminate-rule-insufficient", "pdf-speaker-label-blocks-v1", null, null, null, 49, null],
      ["S05", "sufficient-under-frozen-rule", "paragraph-speaker-blocks-v1", 72, 72, 29, 29, 17],
      ["S07", "zero-under-frozen-rule", "paragraph-speaker-blocks-v1", 21, 21, 0, 0, 0],
      ["S08", "indeterminate-rule-insufficient", "pdf-speaker-label-blocks-v1", null, null, null, 96, null],
      ["S09", "limited-under-frozen-rule", "pdf-speaker-label-blocks-v1", 11, 11, 5, 5, 5],
      ["S13", "sufficient-under-frozen-rule", "paragraph-speaker-blocks-v1", 61, 61, 23, 23, 19],
      ["S16", "zero-under-frozen-rule", "paragraph-speaker-blocks-v1", 20, 20, 0, 0, 0],
      ["S17", "zero-under-frozen-rule", "indexed-caption-speaker-blocks-v1", 210, null, 0, 0, 0],
      ["S18", "indeterminate-rule-insufficient", "pdf-attributed-statement-blocks-v1", null, null, 2, 2, null],
    ]);
  });

  it("rejects audit metadata detached from a registered source fingerprint", async () => {
    const root = await fixtureRoot((audit) => {
      audit.sources[0]!.content_fingerprint = `sha256:${"0".repeat(64)}`;
    });
    await expect(validatePersonalitySamplingCapacityAudit(root))
      .rejects.toThrow("Capacity audit provenance mismatch for S02");
  });

  it("rejects an audit detached from its frozen failed-plan snapshot", async () => {
    const root = await fixtureRoot((audit) => {
      audit.failed_sampling_plan_fingerprint = `sha256:${"0".repeat(64)}`;
    });
    await expect(validatePersonalitySamplingCapacityAudit(root))
      .rejects.toThrow("Capacity audit snapshot is stale");
  });

  it("rejects a capacity count produced under a different segmentation rule", async () => {
    const root = await fixtureRoot((audit) => {
      audit.sources[0]!.segmentation_rule = "pdf-speaker-label-blocks-v1";
    });
    await expect(validatePersonalitySamplingCapacityAudit(root))
      .rejects.toThrow("Capacity audit rule mismatch for S02");
  });

  it("rejects capacity metadata recorded before the failed-plan outcome", async () => {
    const root = await fixtureRoot((audit) => {
      audit.audited_at = "2026-08-27T09:48:58Z";
    });
    await expect(validatePersonalitySamplingCapacityAudit(root))
      .rejects.toThrow("Capacity audit predates its register or failed-plan outcome");
  });
});

interface CapacityAuditFixture {
  audited_at: string;
  failed_sampling_plan_fingerprint: string;
  sources: Array<{ content_fingerprint: string; segmentation_rule: string }>;
}

async function fixtureRoot(change: (audit: CapacityAuditFixture) => void): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "jolene-capacity-audit-"));
  const research = path.join(root, "research");
  await mkdir(research);
  const sourceRoot = path.join(process.cwd(), "research");
  const files = [
    "allocation-capacity-audit-v1.yaml", "sampling-plan-v3.yaml",
    "sampling-plan-v3-outcome.yaml", "source-events-v2.yaml", "sources.yaml",
  ];
  const texts = await Promise.all(files.map((file) => readFile(path.join(sourceRoot, file), "utf8")));
  const audit = parse(texts[0]!) as CapacityAuditFixture;
  change(audit);
  texts[0] = stringify(audit);
  await Promise.all(files.map((file, index) =>
    writeFile(path.join(research, file), texts[index]!, "utf8")));
  return root;
}
