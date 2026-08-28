import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { conversationalQualitySuiteSchema } from
  "../src/evaluation/conversational-quality-evaluation.js";
import {
  buildPersonalityEvaluationBaselineV1,
  validatePersonalityEvaluationBaselineV1,
} from "../src/evaluation/personality-evaluation-baseline-v1.js";
import { fingerprint } from "../src/personality/personality-admission-audit-v1.js";
import { personalityBehaviorSpecV1Schema } from
  "../src/personality/personality-behavior-spec-v1.js";
import { personalityTrustRightsReviewV1Schema } from
  "../src/personality/personality-trust-rights-review-v1.js";

async function artifacts() {
  const [baselineText, specificationText, trustReviewText, suiteText] = await Promise.all([
    readFile(new URL("../evaluations/personality-evaluation-baseline-v1.json", import.meta.url), "utf8"),
    readFile(new URL("../research/personality-behavior-spec-v1.json", import.meta.url), "utf8"),
    readFile(new URL("../research/personality-trust-rights-review-v1.json", import.meta.url), "utf8"),
    readFile(new URL("../evaluations/conversational-quality-v1.json", import.meta.url), "utf8"),
  ]);
  return {
    baseline: JSON.parse(baselineText),
    specification: personalityBehaviorSpecV1Schema.parse(JSON.parse(specificationText)),
    trustReview: personalityTrustRightsReviewV1Schema.parse(JSON.parse(trustReviewText)),
    suite: conversationalQualitySuiteSchema.parse(JSON.parse(suiteText)),
    suiteFingerprint: fingerprint(suiteText),
  };
}

describe("personality evaluation baseline v1", () => {
  it("binds complete conversational and deterministic neutral coverage", async () => {
    const input = await artifacts();
    const baseline = validatePersonalityEvaluationBaselineV1(
      input.baseline, input.specification, input.trustReview,
      input.suite, input.suiteFingerprint,
    );
    expect(baseline.coverage).toMatchObject({
      conversationalCases: 9,
      behaviorContexts: expect.arrayContaining(["normal", "sensitive", "urgent", "public", "private", "error", "conflict"]),
      rendererContexts: expect.arrayContaining(["grief_or_acute_pain", "urgent_incident", "public_or_shared"]),
    });
    expect(baseline.neutralBaseline).toMatchObject({
      passed: true, caseCount: 11, semanticInvariantRate: 1, hardFailureCount: 0,
    });
  });

  it("preserves the approved private packet instead of recapturing it", async () => {
    const { baseline } = await artifacts();
    expect(baseline.thresholds).toMatchObject({
      minimumWeightedMean: 3.3,
      minimumOriginalityPerCase: 3,
      humanReview: "required",
      approvedPacketStorage: "private-external-not-embedded",
    });
    expect(baseline.releaseDisposition.humanReview).toBe("preserved-not-recaptured");
  });

  it("rebuilds deterministically from exact reviewed sources", async () => {
    const input = await artifacts();
    expect(buildPersonalityEvaluationBaselineV1(
      input.specification, input.trustReview, input.suite, input.suiteFingerprint,
    )).toEqual(input.baseline);
  });

  it("rejects a stale suite fingerprint or weakened baseline result", async () => {
    const input = await artifacts();
    expect(() => validatePersonalityEvaluationBaselineV1(
      input.baseline, input.specification, input.trustReview, input.suite,
      `sha256:${"0".repeat(64)}`,
    )).toThrow("does not match its reviewed sources");
    const changed = structuredClone(input.baseline);
    changed.neutralBaseline.passed = false;
    expect(() => validatePersonalityEvaluationBaselineV1(
      changed, input.specification, input.trustReview,
      input.suite, input.suiteFingerprint,
    )).toThrow();
  });
});
