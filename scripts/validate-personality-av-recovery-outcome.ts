import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { loadPersonalityAvRecoveryOutcomeV1 } from
  "../src/personality/personality-av-recovery-outcome.js";

export async function validatePersonalityAvRecoveryOutcome(projectRoot = process.cwd()) {
  return loadPersonalityAvRecoveryOutcomeV1(projectRoot);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await validatePersonalityAvRecoveryOutcome();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
