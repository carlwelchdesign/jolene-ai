import { loadPersonalitySamplingPlanV4Outcome } from
  "../src/personality/personality-sampling-plan-v4-outcome.js";

process.stdout.write(`${JSON.stringify(
  await loadPersonalitySamplingPlanV4Outcome(), null, 2,
)}\n`);
