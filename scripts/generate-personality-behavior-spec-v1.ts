import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { personalityCharacterGraphV1Schema } from
  "../src/personality/personality-character-graph-v1.js";
import { buildPersonalityBehaviorSpecV1 } from
  "../src/personality/personality-behavior-spec-v1.js";

export async function generatePersonalityBehaviorSpecV1(projectRoot = process.cwd()) {
  const graph = personalityCharacterGraphV1Schema.parse(JSON.parse(await readFile(
    path.resolve(projectRoot, "research/personality-character-graph-v1.json"), "utf8",
  )));
  const specification = buildPersonalityBehaviorSpecV1(graph);
  const outputPath = path.resolve(projectRoot, "research/personality-behavior-spec-v1.json");
  await mkdir(path.dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.${process.pid}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(specification, null, 2)}\n`, { mode: 0o600 });
    await rename(temporaryPath, outputPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
  return { outputPath, specification };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { outputPath, specification } = await generatePersonalityBehaviorSpecV1();
  process.stdout.write(`${JSON.stringify({
    outputPath,
    specificationFingerprint: specification.specificationFingerprint,
    contexts: specification.contextMatrix.length,
    admittedRules: specification.behaviorRules.auditedAdmitted.length,
    deferredTraits: specification.behaviorRules.deferredTraits.length,
    runtimeActivation: specification.runtimeActivation,
  }, null, 2)}\n`);
}
