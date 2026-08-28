import { describe, expect, it } from "vitest";

import {
  calculateRecodingAgreement,
  loadPersonalityCategoricalCodebookV1,
  personalityRecodingV1Schema,
  validatePersonalityRecodingV1,
  type PersonalityRecodingV1,
} from "../src/personality/personality-recoding-v1.js";
import { readFile } from "node:fs/promises";

const coding = {
  speechAct: "answer" as const,
  researchContext: "work-practice" as const,
  traitFamilyId: "disciplined-agency" as const,
  seriousnessPivot: false,
};

function rows(): PersonalityRecodingV1["rows"] {
  return Array.from({ length: 118 }, (_, index) => ({
    observationId: `T${String(index + 1).padStart(3, "0")}`,
    selectionId: `SEL-S02-${String(index + 1).padStart(4, "0")}`,
    sourceEventId: "E002",
    reviewReasons: ["minimum-sample"],
    recoderAAssignedAt: "2026-08-28T21:10:00.000Z",
    recoderACodedAt: "2026-08-28T21:11:00.000Z",
    recoderBAssignedAt: "2026-08-28T21:10:00.000Z",
    recoderBCodedAt: "2026-08-28T21:11:00.000Z",
    reconciledAt: "2026-08-28T21:12:00.000Z",
    recoderA: coding,
    recoderB: coding,
    changedFields: [],
    reconciledCoding: coding,
    adjudicationRationale:
      "Both blinded recoders independently produced the same categorical assignment.",
  })) as PersonalityRecodingV1["rows"];
}

describe("personality recoding v1", () => {
  it("loads the committed passing recoding artifact", async () => {
    const artifact = personalityRecodingV1Schema.parse(JSON.parse(
      await readFile("research/personality-recoding-v1.json", "utf8"),
    ));
    await expect(validatePersonalityRecodingV1(artifact)).resolves.toMatchObject({
      turns: 118,
      rawCategoricalAgreement: 0.836864406779661,
      traitFamilyKappa: 0.7463238455585175,
      disagreementRows: 50,
      thresholdsMet: true,
      sourceContentStored: false,
      runtimeActivation: "prohibited",
    });
  }, 90_000);

  it("loads the prospective codebook with frozen blind-review thresholds", async () => {
    await expect(loadPersonalityCategoricalCodebookV1()).resolves.toMatchObject({
      codebook: {
        status: "prospective-frozen-before-recoding",
        reviewProtocol: {
          completeRequiredSet: 118,
          blindToPrimaryRound: true,
          blindToOtherRecoder: true,
          minimumRawCategoricalAgreement: 0.8,
          minimumTraitFamilyKappa: 0.6,
        },
        runtimeActivation: "prohibited",
      },
      fingerprint: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
    });
  });

  it("calculates perfect raw agreement and kappa from two blinded codings", () => {
    expect(calculateRecodingAgreement(rows())).toEqual({
      rawCategoricalAgreement: 1,
      traitFamilyKappa: 1,
      disagreementRows: 0,
    });
  });

  it("rejects source text and runtime activation at the artifact boundary", () => {
    const base = {
      schemaVersion: "jolene.personality-recoding.v1",
      status: "recoding-passed-awaiting-rights-and-trait-admission-audit",
      completedAt: "2026-08-28T21:13:00.000Z",
      primaryCodingFingerprint: `sha256:${"1".repeat(64)}`,
      round1Fingerprint: `sha256:${"2".repeat(64)}`,
      codebookFingerprint: `sha256:${"3".repeat(64)}`,
      recoderA: reviewer("recoder-a"),
      recoderB: reviewer("recoder-b"),
      adjudicator: reviewer("adjudicator"),
      rows: rows(),
      agreement: calculateRecodingAgreement(rows()),
      coverage: {
        turns: 118, sources: 10, researchContexts: 8, sensitiveTurns: 84,
        lowConfidenceTurns: 17, traitAdmissionCandidateTurns: 31,
      },
      round1Preserved: true,
      sourceContentStored: false,
      excerptsStored: false,
      traitAdmission: "prohibited",
      runtimeActivation: "prohibited",
    };
    expect(() => personalityRecodingV1Schema.parse({
      ...base, sourceText: "untrusted source material",
    })).toThrow();
    expect(() => personalityRecodingV1Schema.parse({
      ...base, runtimeActivation: "allowed",
    })).toThrow();
  });
});

function reviewer(reviewerId: string) {
  return {
    reviewerId,
    reviewerType: "ai",
    tool: "Structured fixture reviewer",
    modelVersion: "test-model",
  };
}
