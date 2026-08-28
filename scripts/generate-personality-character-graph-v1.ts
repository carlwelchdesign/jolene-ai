import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { PersonalityCorpusV2 } from
  "../src/personality/personality-corpus-contract.js";
import {
  fingerprint,
  personalityAdmissionAuditV1Schema,
  validatePersonalityAdmissionAuditV1,
} from "../src/personality/personality-admission-audit-v1.js";
import { buildPersonalityCharacterGraphV1 } from
  "../src/personality/personality-character-graph-v1.js";

export async function generatePersonalityCharacterGraphV1(projectRoot = process.cwd()) {
  const corpusPath = path.resolve(projectRoot, "research/personality-corpus-v2-reviewed.json");
  const auditPath = path.resolve(projectRoot, "research/personality-admission-audit-v1.json");
  const outputPath = path.resolve(projectRoot, "research/personality-character-graph-v1.json");
  const [corpusText, auditText] = await Promise.all([
    readFile(corpusPath, "utf8"),
    readFile(auditPath, "utf8"),
  ]);
  const corpus = JSON.parse(corpusText) as PersonalityCorpusV2;
  const audit = personalityAdmissionAuditV1Schema.parse(JSON.parse(auditText));
  await validatePersonalityAdmissionAuditV1(audit, corpus, projectRoot);
  const graph = buildPersonalityCharacterGraphV1(corpus, audit, fingerprint(auditText));
  await writeJsonAtomic(outputPath, graph);
  return { outputPath, graph };
}

async function writeJsonAtomic(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { outputPath, graph } = await generatePersonalityCharacterGraphV1();
  process.stdout.write(`${JSON.stringify({
    outputPath,
    graphFingerprint: graph.graphFingerprint,
    traitNodes: graph.traitNodes.length,
    observationNodes: graph.observationNodes.length,
    constraintNodes: graph.constraintNodes.length,
    evidenceEdges: graph.evidenceEdges.length,
    constraintEdges: graph.constraintEdges.length,
  }, null, 2)}\n`);
}
