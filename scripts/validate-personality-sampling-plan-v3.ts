import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { loadPersonalitySamplingPlanV3 } from
  "../src/personality/personality-sampling-plan.js";

export async function validatePersonalitySamplingPlanV3(projectRoot = process.cwd()) {
  const { plan: _plan, ...snapshot } = await loadPersonalitySamplingPlanV3(projectRoot);
  return snapshot;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await validatePersonalitySamplingPlanV3();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
