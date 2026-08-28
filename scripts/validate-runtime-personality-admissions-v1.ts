import { readFile } from "node:fs/promises";
import path from "node:path";

import { validateRuntimePersonalityAdmissionsArtifact } from
  "../src/personality/runtime-personality-admissions-v1.js";

const projectRoot = process.cwd();
const rawAuditJson = await readFile(
  path.resolve(projectRoot, "research/personality-admission-audit-v1.json"),
  "utf8",
);

const result = validateRuntimePersonalityAdmissionsArtifact(rawAuditJson);
console.log(JSON.stringify({
  ok: true,
  ...result,
}, null, 2));
