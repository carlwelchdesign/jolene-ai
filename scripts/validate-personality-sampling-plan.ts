import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { loadPersonalitySamplingAuditV2 } from
  "../src/personality/personality-sampling-plan.js";
import { loadPersonalitySamplingOutcomeV2 } from
  "../src/personality/personality-sampling-plan.js";

export async function validatePersonalitySamplingPlan(projectRoot = process.cwd()) {
  const [snapshot, outcome] = await Promise.all([
    loadPersonalitySamplingAuditV2(projectRoot),
    loadPersonalitySamplingOutcomeV2(projectRoot),
  ]);
  return {
    schemaVersion: snapshot.schemaVersion,
    planFingerprint: snapshot.planFingerprint,
    createdAt: snapshot.createdAt,
    sourceRegisterFingerprint: snapshot.sourceRegisterFingerprint,
    sourceRegisterState: snapshot.sourceRegisterState,
    targetAtomicTurns: snapshot.targetAtomicTurns,
    systematicTurns: snapshot.systematicTurns,
    purposiveHighRiskTurns: snapshot.purposiveHighRiskTurns,
    sourceEvents: snapshot.sourceEvents,
    historicalDiversityMetricsRecomputed: snapshot.historicalDiversityMetricsRecomputed,
    runtimeActivation: snapshot.runtimeActivation,
    outcome: {
      status: outcome.status,
      failureCode: outcome.failure.code,
      failureSourceId: outcome.failure.source_register_id,
      boundaryUnitsReviewed: outcome.failure.boundary_units_reviewed,
      explicitlyAttributedTargetTurns: outcome.failure.explicitly_attributed_target_turns,
      observationsCreated: outcome.observations_created,
      replacementOrResamplingPerformed: outcome.replacement_or_resampling_performed,
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await validatePersonalitySamplingPlan();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
