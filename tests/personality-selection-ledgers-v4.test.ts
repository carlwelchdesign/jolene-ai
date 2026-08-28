import { access } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { auditPersonalitySelectionPlanV4, buildPersonalitySelectionArtifactsV4 } from
  "../src/personality/personality-selection-ledgers-v4.js";
import { loadPersonalitySamplingPlanV4Outcome } from
  "../src/personality/personality-sampling-plan-v4-outcome.js";

describe("personality selection ledgers v4", () => {
  it("fails closed before committing duplicate candidate selections", async () => {
    const audit = await auditPersonalitySelectionPlanV4("2026-08-28T07:30:00Z");
    expect(audit).toMatchObject({
      candidateSelectedTurns: 120, selectionAccepted: false,
      duplicateSelectedTurns: 8, sourceContentStored: false,
      observationCodingPerformed: false, runtimeActivation: "prohibited",
    });
    expect(audit.duplicateGroups).toHaveLength(4);
    expect(audit.duplicateGroups.every((group) =>
      group.units.every((unit) => unit.sourceRegisterId === "S03" &&
        unit.selectionRuleId === "SAM-001")
    )).toBe(true);
    await expect(buildPersonalitySelectionArtifactsV4("2026-08-28T07:30:00Z"))
      .rejects.toThrow("selects duplicate segment fingerprints (4 groups)");
  });

  it("binds the immutable failure outcome to the exact v4 plan and candidate audit", async () => {
    const outcome = await loadPersonalitySamplingPlanV4Outcome();
    expect(outcome).toMatchObject({
      status: "failed-before-selection-and-coding",
      samplingPlanFingerprint:
        "sha256:00cd994166788086361fe19952892c06b1db1dba18bcc1c9971e015965137627",
      failure: {
        code: "duplicate-segment-fingerprints-in-candidate-selection",
        sourceRegisterId: "S03", duplicateSelectedTurns: 8,
      },
      committedSelectionLedgers: 0, selectionPerformed: false,
      observationsCreated: 0, outcomeBasedReplacementPerformed: false,
      runtimeActivation: "prohibited",
    });
    expect(outcome.failure.duplicateGroups).toHaveLength(4);
  });

  it("leaves no partially accepted selection artifact", async () => {
    await expect(access(path.resolve("research/selection-manifest-v4.yaml"))).rejects.toThrow();
    await expect(access(path.resolve(
      "research/selection-ledgers-v4/source-S03.json",
    ))).rejects.toThrow();
  });
});
