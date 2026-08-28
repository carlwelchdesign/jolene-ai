import { describe, expect, it } from "vitest";

import { loadS03DuplicateOverlapAudit, s03DuplicateOverlapAuditSchema } from
  "../src/personality/personality-s03-duplicate-overlap-audit.js";

describe("S03 duplicate-overlap audit", () => {
  it("reconciles every eligible occurrence into a conservative unique group", async () => {
    const audit = await loadS03DuplicateOverlapAudit();
    expect(audit.counts).toEqual({
      eligibleOccurrences: 270, uniqueFingerprintGroups: 133,
      duplicateFingerprintGroups: 133, duplicateOccurrencesBeyondRepresentative: 137,
      cleanConsensusGroups: 70, uncertaintyWithheldGroups: 63,
      metadataConflictGroups: 41, groupsContainingPriorUncertainty: 28,
      proposedAdmittedHighRiskGroups: 49,
    });
    expect(audit.groups.reduce((sum, group) => sum + group.memberCount, 0)).toBe(270);
    expect(audit.groups.every((group) =>
      group.representativeCapacityUnitId === group.members[0]!.capacityUnitId &&
      group.representativeSourceUnitOrdinal === group.members[0]!.sourceUnitOrdinal
    )).toBe(true);
    expect(audit).toMatchObject({
      sourceContentStored: false, selectionPerformed: false,
      observationCodingPerformed: false, traitAdmission: "prohibited",
      runtimeActivation: "prohibited",
    });
  }, 15_000);

  it("rejects silently admitting a conflicting group's labels", async () => {
    const loaded = await loadS03DuplicateOverlapAudit();
    const { auditFingerprint: _fingerprint, ...audit } = loaded;
    const changed = structuredClone(audit);
    const conflict = changed.groups.find((group) => group.metadataConflict)!;
    conflict.proposedHighRiskReviewState = "consensus";
    conflict.proposedAgreedHighRiskStrata = ["biography"];
    expect(s03DuplicateOverlapAuditSchema.safeParse(changed).success).toBe(false);
  }, 15_000);
});
