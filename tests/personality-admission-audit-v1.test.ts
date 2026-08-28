import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import type { PersonalityCorpusV2 } from
  "../src/personality/personality-corpus-contract.js";
import {
  personalityAdmissionAuditV1Schema,
  validatePersonalityAdmissionAuditV1,
} from "../src/personality/personality-admission-audit-v1.js";

async function fixture() {
  const [auditText, corpusText] = await Promise.all([
    readFile("research/personality-admission-audit-v1.json", "utf8"),
    readFile("research/personality-corpus-v2-reviewed.json", "utf8"),
  ]);
  return {
    audit: personalityAdmissionAuditV1Schema.parse(JSON.parse(auditText)),
    corpus: JSON.parse(corpusText) as PersonalityCorpusV2,
  };
}

describe("personality admission audit v1", () => {
  it("validates the reviewed non-activating corpus and admission decisions", async () => {
    const { audit, corpus } = await fixture();
    await expect(validatePersonalityAdmissionAuditV1(audit, corpus)).resolves.toMatchObject({
      admittedTraits: 1,
      deferredTraits: 7,
      maximumConsecutiveSourceOverlapWords: 3,
      eightWordSourceOverlaps: 0,
      sourceContentStored: false,
      traitAdmissionComplete: true,
      runtimeActivation: "prohibited",
    });
    expect(audit.admittedTraits).toEqual(["uncertainty-humility"]);
    expect(audit.traitDecisions.find(
      (decision) => decision.traitFamilyId === "uncertainty-humility",
    )).toMatchObject({
      decision: "admitted",
      eligibleSupportCount: 7,
      sourceEvents: 4,
      settingFamilies: 4,
      timeBands: 3,
      ownerDecision: "approved",
    });
  }, 90_000);

  it("keeps all recognizable-expression and activation channels closed", async () => {
    const { audit } = await fixture();
    expect(audit.rights).toMatchObject({
      sourceContentStored: false,
      excerptsStored: false,
      lyricsStored: false,
      recognizableExpression: "prohibited",
      dialectImitation: "prohibited",
      voiceImitation: "prohibited",
      defaultIntimacy: "prohibited",
      biographyOrBeliefTransfer: "excluded-from-trait-support",
    });
    expect(audit.antiCaricatureRules).toHaveLength(7);
    expect(audit.runtimeActivation).toBe("prohibited");
  });

  it("rejects source content and additional admitted traits at the schema boundary", async () => {
    const { audit } = await fixture();
    expect(() => personalityAdmissionAuditV1Schema.parse({
      ...audit,
      sourceText: "untrusted source material",
    })).toThrow();
    expect(() => personalityAdmissionAuditV1Schema.parse({
      ...audit,
      admittedTraits: ["uncertainty-humility", "calibrated-wit"],
    })).toThrow();
  });
});
