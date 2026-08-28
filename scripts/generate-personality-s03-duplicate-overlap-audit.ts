import { rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { buildS03DuplicateOverlapAudit } from
  "../src/personality/personality-s03-duplicate-overlap-audit.js";

const createdAt = process.env.JOLENE_S03_DUPLICATE_AUDIT_CREATED_AT;
if (!createdAt) throw new Error("JOLENE_S03_DUPLICATE_AUDIT_CREATED_AT is required");
const audit = await buildS03DuplicateOverlapAudit(createdAt);
const output = path.resolve(process.cwd(), "research/s03-duplicate-overlap-audit-v1.json");
const temporary = `${output}.${process.pid}.tmp`;
await writeFile(temporary, `${JSON.stringify(audit, null, 2)}\n`, {
  encoding: "utf8", mode: 0o600,
});
await rename(temporary, output);
process.stdout.write(`${JSON.stringify({ counts: audit.counts }, null, 2)}\n`);
