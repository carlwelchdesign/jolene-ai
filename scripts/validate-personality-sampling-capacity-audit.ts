import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { loadPersonalitySamplingCapacityAuditV1 } from
  "../src/personality/personality-sampling-capacity-audit.js";

export async function validatePersonalitySamplingCapacityAudit(projectRoot = process.cwd()) {
  return loadPersonalitySamplingCapacityAuditV1(projectRoot);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await validatePersonalitySamplingCapacityAudit();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
