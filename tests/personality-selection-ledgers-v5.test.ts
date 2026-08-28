import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertGloballyUniqueSelectedFingerprints,
  buildPersonalitySelectionArtifactsV5,
  loadPersonalitySelectionArtifactsV5,
  writePersonalitySelectionArtifactsV5,
} from "../src/personality/personality-selection-ledgers-v5.js";

describe("personality selection ledgers v5", () => {
  it("freezes 120 globally unique selections from corrected capacity", async () => {
    const result = await loadPersonalitySelectionArtifactsV5();
    expect(result.totals).toEqual({
      sources: 10,
      boundaryUnits: 1406,
      sourceEligibleOccurrences: 588,
      effectiveEligibleUnits: 451,
      selectedTurns: 120,
      systematicTurns: 96,
      purposiveHighRiskTurns: 24,
      nonSelectedEffectiveUnits: 331,
      collapsedDuplicateOccurrences: 137,
      excludedUnits: 818,
      excludedRanges: 695,
      uniqueSelectedSegmentFingerprints: 120,
    });
    const s03 = result.ledgers.find((ledger) => ledger.sourceRegisterId === "S03")!;
    expect(s03).toMatchObject({
      sourceEligibleOccurrences: 270,
      effectiveEligibleCapacity: 133,
      allocation: { targetTurns: 14, systematicTurns: 8, purposiveHighRiskTurns: 6 },
      globalFingerprintUniquenessPreflight: "passed-before-artifact-write",
    });
    expect(s03.collapsedDuplicateOccurrences).toHaveLength(137);
    expect(s03.selectedUnits.every((unit) => unit.effectiveUnitId.startsWith("U-S03-"))).toBe(true);
  }, 30_000);

  it("fails the global preflight when any selected fingerprint is duplicated", async () => {
    const artifacts = await buildPersonalitySelectionArtifactsV5("2026-08-28T08:10:00Z");
    const changed = structuredClone(artifacts.ledgers);
    changed[1]!.selectedUnits[0]!.segmentFingerprint =
      changed[0]!.selectedUnits[0]!.segmentFingerprint;
    expect(() => assertGloballyUniqueSelectedFingerprints(changed)).toThrow(
      /Duplicate selected segment fingerprint/u,
    );
  }, 30_000);

  it("leaves no output directory when preflight fails before writing", async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), "jolene-selection-v5-"));
    const output = path.resolve(temporary, "selection-v5");
    try {
      await expect(writePersonalitySelectionArtifactsV5(
        "2026-08-28T07:59:59Z", process.cwd(), output,
      )).rejects.toThrow("predates sampling plan v5");
      await expect(access(output)).rejects.toThrow();
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }, 30_000);

  it("persists metadata only and no observation coding", async () => {
    const manifest = await readFile("research/selection-v5/manifest.yaml", "utf8");
    const s03 = await readFile("research/selection-v5/ledgers/source-S03.json", "utf8");
    const text = `${manifest}\n${s03}`;
    expect(text).not.toMatch(/"(?:sourceText|source_text|excerpt|quote|transcript|lyrics)"/u);
    expect(text).toContain("observationCodingPerformed: false");
    expect(s03).toContain('"sourceContentStored": false');
  });
});
