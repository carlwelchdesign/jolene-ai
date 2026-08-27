import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { parse, stringify } from "yaml";
import { describe, expect, it } from "vitest";

import { validatePersonalityAvRecoveryOutcome } from
  "../scripts/validate-personality-av-recovery-outcome.js";

describe("personality AV attribution recovery outcome", () => {
  it("records a clean two-source failure before any map or selection", async () => {
    await expect(validatePersonalityAvRecoveryOutcome()).resolves.toMatchObject({
      schemaVersion: "jolene.personality-av-attribution-recovery-outcome.v1",
      status: "failed-before-map-creation",
      failedSources: ["S16", "S17"],
      expectedUnits: 230,
      reviewedUnits: 0,
      mapFilesCreated: 0,
      sourceContentStored: false,
      selectionPerformed: false,
      observationsCreated: 0,
      replacementPerformed: false,
      runtimeActivation: "prohibited",
    });
  });

  it("rejects an outcome detached from the frozen boundary protocol", async () => {
    const root = await fixtureRoot((outcome) => {
      outcome.boundary_protocol_fingerprint = `sha256:${"0".repeat(64)}`;
    });
    await expect(validatePersonalityAvRecoveryOutcome(root))
      .rejects.toThrow("AV recovery outcome prerequisites are stale");
  });

  it("rejects an outcome recorded before the protocol existed", async () => {
    const root = await fixtureRoot((outcome) => {
      outcome.evaluated_at = "2026-08-27T10:13:59Z";
    });
    await expect(validatePersonalityAvRecoveryOutcome(root))
      .rejects.toThrow("AV recovery outcome predates its prerequisites");
  });
});

interface OutcomeFixture {
  boundary_protocol_fingerprint: string;
  evaluated_at: string;
}

async function fixtureRoot(change: (outcome: OutcomeFixture) => void): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "jolene-av-recovery-"));
  const research = path.join(root, "research");
  await mkdir(research);
  const sourceRoot = path.join(process.cwd(), "research");
  const files = [
    "av-attribution-recovery-outcome-v1.yaml", "sampling-boundary-protocol-v1.yaml",
    "allocation-capacity-audit-v1.yaml", "sampling-plan-v3.yaml",
    "sampling-plan-v3-outcome.yaml", "source-events-v2.yaml", "sources.yaml",
  ];
  const texts = await Promise.all(files.map((file) => readFile(path.join(sourceRoot, file), "utf8")));
  const outcome = parse(texts[0]!) as OutcomeFixture;
  change(outcome);
  texts[0] = stringify(outcome);
  await Promise.all(files.map((file, index) =>
    writeFile(path.join(research, file), texts[index]!, "utf8")));
  return root;
}
