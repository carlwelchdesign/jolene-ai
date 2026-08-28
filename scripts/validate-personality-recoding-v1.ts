import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  personalityRecodingV1Schema,
  validatePersonalityRecodingV1,
} from "../src/personality/personality-recoding-v1.js";

export async function validatePersonalityRecodingArtifactV1(projectRoot = process.cwd()) {
  const text = await readFile(
    path.resolve(projectRoot, "research/personality-recoding-v1.json"), "utf8",
  );
  return validatePersonalityRecodingV1(
    personalityRecodingV1Schema.parse(JSON.parse(text)), projectRoot,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.stdout.write(`${JSON.stringify(await validatePersonalityRecodingArtifactV1(), null, 2)}\n`);
}
