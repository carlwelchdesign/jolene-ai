import { loadPersonalitySamplingPlanV5 } from
  "../src/personality/personality-sampling-plan-v5.js";

process.stdout.write(`${JSON.stringify(await loadPersonalitySamplingPlanV5(), null, 2)}\n`);
