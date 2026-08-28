import { loadPersonalitySamplingPlanV4 } from
  "../src/personality/personality-sampling-plan-v4.js";

process.stdout.write(`${JSON.stringify(await loadPersonalitySamplingPlanV4(), null, 2)}\n`);
