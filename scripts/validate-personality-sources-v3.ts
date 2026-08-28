import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { loadPersonalitySourceRegisterV3 } from
  "../src/personality/personality-source-register-v3.js";

export async function validatePersonalitySourcesV3(projectRoot = process.cwd()) {
  const { events: _events, ...snapshot } = await loadPersonalitySourceRegisterV3(projectRoot);
  return snapshot;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await validatePersonalitySourcesV3();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
