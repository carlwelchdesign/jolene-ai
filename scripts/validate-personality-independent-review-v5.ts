import path from "node:path";
import { pathToFileURL } from "node:url";

import { loadPersonalityIndependentReviewV5 } from
  "../src/personality/personality-independent-review-v5.js";

export async function validatePersonalityIndependentReviewArtifactV5(
  projectRoot = process.cwd(),
) {
  return loadPersonalityIndependentReviewV5(projectRoot);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = await validatePersonalityIndependentReviewArtifactV5();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
