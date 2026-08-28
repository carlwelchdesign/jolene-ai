import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { loadPersonalityPdfCueAdjudicationAuditV1 } from
  "../src/personality/personality-pdf-cue-audit.js";

export async function validatePersonalityPdfCueAudit(projectRoot = process.cwd()) {
  return loadPersonalityPdfCueAdjudicationAuditV1(projectRoot);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await validatePersonalityPdfCueAudit();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
