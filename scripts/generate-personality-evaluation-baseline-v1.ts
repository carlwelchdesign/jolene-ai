import { readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { conversationalQualitySuiteSchema } from
  "../src/evaluation/conversational-quality-evaluation.js";
import { buildPersonalityEvaluationBaselineV1 } from
  "../src/evaluation/personality-evaluation-baseline-v1.js";
import { fingerprint } from "../src/personality/personality-admission-audit-v1.js";
import { personalityBehaviorSpecV1Schema } from
  "../src/personality/personality-behavior-spec-v1.js";
import { personalityTrustRightsReviewV1Schema } from
  "../src/personality/personality-trust-rights-review-v1.js";

export async function generatePersonalityEvaluationBaselineV1(projectRoot = process.cwd()) {
  const [specificationText, trustReviewText, suiteText] = await Promise.all([
    readFile(path.resolve(projectRoot, "research/personality-behavior-spec-v1.json"), "utf8"),
    readFile(path.resolve(projectRoot, "research/personality-trust-rights-review-v1.json"), "utf8"),
    readFile(path.resolve(projectRoot, "evaluations/conversational-quality-v1.json"), "utf8"),
  ]);
  const baseline = buildPersonalityEvaluationBaselineV1(
    personalityBehaviorSpecV1Schema.parse(JSON.parse(specificationText)),
    personalityTrustRightsReviewV1Schema.parse(JSON.parse(trustReviewText)),
    conversationalQualitySuiteSchema.parse(JSON.parse(suiteText)),
    fingerprint(suiteText),
  );
  const outputPath = path.resolve(projectRoot, "evaluations/personality-evaluation-baseline-v1.json");
  const temporaryPath = `${outputPath}.${process.pid}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(baseline, null, 2)}\n`, { mode: 0o600 });
    await rename(temporaryPath, outputPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
  return { outputPath, baseline };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { outputPath, baseline } = await generatePersonalityEvaluationBaselineV1();
  process.stdout.write(`${JSON.stringify({
    outputPath,
    evaluationFingerprint: baseline.evaluationFingerprint,
    conversationalCases: baseline.coverage.conversationalCases,
    behaviorContexts: baseline.coverage.behaviorContexts.length,
    rendererContexts: baseline.coverage.rendererContexts.length,
    neutralBaselinePassed: baseline.neutralBaseline.passed,
    runtimeActivation: baseline.releaseDisposition.runtimeActivation,
  }, null, 2)}\n`);
}
