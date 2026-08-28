import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { personalityCharacterGraphV1Schema } from
  "../src/personality/personality-character-graph-v1.js";
import { validatePersonalityBehaviorSpecV1 } from
  "../src/personality/personality-behavior-spec-v1.js";

export async function validatePersonalityBehaviorSpecArtifactV1(projectRoot = process.cwd()) {
  const [specificationText, graphText] = await Promise.all([
    readFile(path.resolve(projectRoot, "research/personality-behavior-spec-v1.json"), "utf8"),
    readFile(path.resolve(projectRoot, "research/personality-character-graph-v1.json"), "utf8"),
  ]);
  const graph = personalityCharacterGraphV1Schema.parse(JSON.parse(graphText));
  const specification = validatePersonalityBehaviorSpecV1(
    JSON.parse(specificationText), graph,
  );
  return {
    specificationFingerprint: specification.specificationFingerprint,
    sourceGraphFingerprint: specification.sourceGraph.graphFingerprint,
    contexts: specification.contextMatrix.length,
    ownerDesignedRules: specification.behaviorRules.ownerDesignedBaseline.length,
    auditedAdmittedRules: specification.behaviorRules.auditedAdmitted.length,
    deferredTraits: specification.behaviorRules.deferredTraits.length,
    antiCaricatureConstraints: specification.antiCaricatureConstraints.length,
    runtimeActivation: specification.runtimeActivation,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.stdout.write(`${JSON.stringify(
    await validatePersonalityBehaviorSpecArtifactV1(), null, 2,
  )}\n`);
}
