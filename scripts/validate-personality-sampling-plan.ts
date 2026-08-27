import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { loadPersonalitySamplingPlanV2 } from
  "../src/personality/personality-sampling-plan.js";

export async function validatePersonalitySamplingPlan(projectRoot = process.cwd()) {
  const snapshot = await loadPersonalitySamplingPlanV2(projectRoot);
  return {
    schemaVersion: snapshot.schemaVersion,
    planFingerprint: snapshot.planFingerprint,
    createdAt: snapshot.createdAt,
    sourceRegisterFingerprint: snapshot.sourceRegisterFingerprint,
    targetAtomicTurns: snapshot.targetAtomicTurns,
    systematicTurns: snapshot.systematicTurns,
    purposiveHighRiskTurns: snapshot.purposiveHighRiskTurns,
    sourceEvents: snapshot.sourceEvents,
    publisherFamilies: snapshot.publisherFamilies,
    settingFamilies: snapshot.settingFamilies,
    timeBands: snapshot.timeBands,
    runtimeActivation: snapshot.runtimeActivation,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await validatePersonalitySamplingPlan();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
