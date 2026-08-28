import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { PersonalityCorpusV2 } from
  "../src/personality/personality-corpus-contract.js";
import {
  personalityAdmissionAuditV1Schema,
  validatePersonalityAdmissionAuditV1,
} from "../src/personality/personality-admission-audit-v1.js";

export async function validatePersonalityAdmissionAuditArtifactV1(
  projectRoot = process.cwd(),
) {
  const [auditText, corpusText] = await Promise.all([
    readFile(path.resolve(projectRoot, "research/personality-admission-audit-v1.json"), "utf8"),
    readFile(path.resolve(projectRoot, "research/personality-corpus-v2-reviewed.json"), "utf8"),
  ]);
  return validatePersonalityAdmissionAuditV1(
    personalityAdmissionAuditV1Schema.parse(JSON.parse(auditText)),
    JSON.parse(corpusText) as PersonalityCorpusV2,
    projectRoot,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.stdout.write(`${JSON.stringify(
    await validatePersonalityAdmissionAuditArtifactV1(), null, 2,
  )}\n`);
}
