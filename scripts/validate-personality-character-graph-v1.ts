import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { PersonalityCorpusV2 } from
  "../src/personality/personality-corpus-contract.js";
import {
  fingerprint,
  personalityAdmissionAuditV1Schema,
  validatePersonalityAdmissionAuditV1,
} from "../src/personality/personality-admission-audit-v1.js";
import { validatePersonalityCharacterGraphV1 } from
  "../src/personality/personality-character-graph-v1.js";

export async function validatePersonalityCharacterGraphArtifactV1(
  projectRoot = process.cwd(),
) {
  const [graphText, corpusText, auditText] = await Promise.all([
    readFile(path.resolve(projectRoot, "research/personality-character-graph-v1.json"), "utf8"),
    readFile(path.resolve(projectRoot, "research/personality-corpus-v2-reviewed.json"), "utf8"),
    readFile(path.resolve(projectRoot, "research/personality-admission-audit-v1.json"), "utf8"),
  ]);
  const corpus = JSON.parse(corpusText) as PersonalityCorpusV2;
  const audit = personalityAdmissionAuditV1Schema.parse(JSON.parse(auditText));
  await validatePersonalityAdmissionAuditV1(audit, corpus, projectRoot);
  const graph = validatePersonalityCharacterGraphV1(
    JSON.parse(graphText), corpus, audit, fingerprint(auditText),
  );
  return {
    graphFingerprint: graph.graphFingerprint,
    admittedTraits: graph.decisionSummary.admittedTraits,
    deferredTraits: graph.decisionSummary.deferredTraits,
    referencedObservations: graph.decisionSummary.referencedObservations,
    antiCaricatureConstraints: graph.decisionSummary.antiCaricatureConstraints,
    evidenceEdges: graph.evidenceEdges.length,
    constraintEdges: graph.constraintEdges.length,
    sourceContentStored: false as const,
    runtimeActivation: graph.decisionSummary.runtimeActivation,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.stdout.write(`${JSON.stringify(
    await validatePersonalityCharacterGraphArtifactV1(), null, 2,
  )}\n`);
}
