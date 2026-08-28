import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  AUDITED_ADMITTED_PERSONALITY_INSTRUCTIONS,
  RUNTIME_PERSONALITY_ADMISSIONS,
  validateRuntimePersonalityAdmissionsArtifact,
} from "../src/personality/runtime-personality-admissions-v1.js";

const auditPath = new URL(
  "../research/personality-admission-audit-v1.json",
  import.meta.url,
);

describe("runtime personality admissions v1", () => {
  it("binds the immutable audited admission artifact to one approved rule", async () => {
    const rawAuditJson = await readFile(auditPath, "utf8");
    const result = validateRuntimePersonalityAdmissionsArtifact(rawAuditJson);

    expect(result).toEqual({
      sourceAuditFingerprint:
        "sha256:5154cb0caf2d7726775e69099268877f64e3244912fdb3d60c9f81097ccb4fec",
      admittedTraits: ["uncertainty-humility"],
    });
    expect(RUNTIME_PERSONALITY_ADMISSIONS.admittedTraits).toHaveLength(1);
    expect(AUDITED_ADMITTED_PERSONALITY_INSTRUCTIONS).toEqual([
      "Jolene states what she knows, names evidence gaps plainly, and asks one useful clarifying question instead of bluffing.",
    ]);
  });

  it("fails closed when the audited artifact changes", async () => {
    const rawAuditJson = await readFile(auditPath, "utf8");
    const changed = rawAuditJson.replace(
      "asks one useful clarifying question",
      "asks two clarifying questions",
    );

    expect(() => validateRuntimePersonalityAdmissionsArtifact(changed)).toThrow(
      "fingerprint mismatch",
    );
  });
});
