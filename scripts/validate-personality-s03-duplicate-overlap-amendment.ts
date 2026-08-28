import { loadS03DuplicateOverlapAmendment } from
  "../src/personality/personality-s03-duplicate-overlap-amendment.js";

process.stdout.write(`${JSON.stringify(await loadS03DuplicateOverlapAmendment(), null, 2)}\n`);
