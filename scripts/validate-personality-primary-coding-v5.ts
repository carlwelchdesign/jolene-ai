import path from "node:path";
import { pathToFileURL } from "node:url";

import { loadPersonalityPrimaryCodingArtifactV5 } from
  "../src/personality/personality-primary-coding-v5.js";

export async function validatePersonalityPrimaryCodingV5(projectRoot = process.cwd()) {
  return loadPersonalityPrimaryCodingArtifactV5(projectRoot);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = await validatePersonalityPrimaryCodingV5();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
