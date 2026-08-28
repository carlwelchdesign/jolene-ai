import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { conversationalQualitySuiteSchema } from
  "../src/evaluation/conversational-quality-evaluation.js";
import { validatePersonalityEvaluationBaselineV1 } from
  "../src/evaluation/personality-evaluation-baseline-v1.js";
import { fingerprint } from "../src/personality/personality-admission-audit-v1.js";
import { personalityBehaviorSpecV1Schema } from
  "../src/personality/personality-behavior-spec-v1.js";
import { personalityTrustRightsReviewV1Schema } from
  "../src/personality/personality-trust-rights-review-v1.js";

export async function validatePersonalityEvaluationBaselineArtifactV1(
  projectRoot = process.cwd(),
) {
  const [baselineText, specificationText, trustReviewText, suiteText] = await Promise.all([
    readFile(path.resolve(projectRoot, "evaluations/personality-evaluation-baseline-v1.json"), "utf8"),
    readFile(path.resolve(projectRoot, "research/personality-behavior-spec-v1.json"), "utf8"),
    readFile(path.resolve(projectRoot, "research/personality-trust-rights-review-v1.json"), "utf8"),
    readFile(path.resolve(projectRoot, "evaluations/conversational-quality-v1.json"), "utf8"),
  ]);
  const baseline = validatePersonalityEvaluationBaselineV1(
    JSON.parse(baselineText),
    personalityBehaviorSpecV1Schema.parse(JSON.parse(specificationText)),
    personalityTrustRightsReviewV1Schema.parse(JSON.parse(trustReviewText)),
    conversationalQualitySuiteSchema.parse(JSON.parse(suiteText)),
    fingerprint(suiteText),
  );
  return {
    evaluationFingerprint: baseline.evaluationFingerprint,
    behaviorContexts: baseline.coverage.behaviorContexts.length,
    conversationalCategories: baseline.coverage.conversationalCategories.length,
    rendererContexts: baseline.coverage.rendererContexts.length,
    hardFailureCodes: baseline.coverage.conversationalHardFailureCodes.length +
      baseline.coverage.invarianceHardFailureCodes.length,
    neutralBaselinePassed: baseline.neutralBaseline.passed,
    humanReview: baseline.releaseDisposition.humanReview,
    runtimeActivation: baseline.releaseDisposition.runtimeActivation,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.stdout.write(`${JSON.stringify(
    await validatePersonalityEvaluationBaselineArtifactV1(), null, 2,
  )}\n`);
}
