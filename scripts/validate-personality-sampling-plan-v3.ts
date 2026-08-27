import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { loadPersonalitySamplingAuditV3 } from
  "../src/personality/personality-sampling-plan.js";
import { loadPersonalitySamplingOutcomeV3 } from
  "../src/personality/personality-sampling-plan.js";

export async function validatePersonalitySamplingPlanV3(projectRoot = process.cwd()) {
  const [snapshot, outcome] = await Promise.all([
    loadPersonalitySamplingAuditV3(projectRoot),
    loadPersonalitySamplingOutcomeV3(projectRoot),
  ]);
  return {
    ...snapshot,
    outcome: {
      status: outcome.status,
      failureCode: outcome.failure.code,
      failureSourceId: outcome.failure.source_register_id,
      boundaryUnitsReviewed: outcome.failure.boundary_units_reviewed,
      explicitlyAttributedTargetTurns: outcome.failure.explicitly_attributed_target_turns,
      observationsCreated: outcome.observations_created,
      committedSelectionLedgers: outcome.committed_selection_ledgers,
      replacementOrResamplingPerformed: outcome.replacement_or_resampling_performed,
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await validatePersonalitySamplingPlanV3();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
