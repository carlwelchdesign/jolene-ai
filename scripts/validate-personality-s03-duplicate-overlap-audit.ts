import { loadS03DuplicateOverlapAudit } from
  "../src/personality/personality-s03-duplicate-overlap-audit.js";

process.stdout.write(`${JSON.stringify(await loadS03DuplicateOverlapAudit(), null, 2)}\n`);
