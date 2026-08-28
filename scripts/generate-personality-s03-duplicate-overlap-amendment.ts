import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { buildS03DuplicateOverlapAmendment } from
  "../src/personality/personality-s03-duplicate-overlap-amendment.js";

const primaryPath = process.env.JOLENE_PRIMARY_S03_DUPLICATE_REVIEW;
const independentPath = process.env.JOLENE_INDEPENDENT_S03_DUPLICATE_REVIEW;
if (!primaryPath || !independentPath) {
  throw new Error(
    "JOLENE_PRIMARY_S03_DUPLICATE_REVIEW and JOLENE_INDEPENDENT_S03_DUPLICATE_REVIEW are required",
  );
}
const projectRoot = process.cwd();
const outputPath = path.resolve(
  projectRoot, "research/s03-duplicate-overlap-amendment-v1.json",
);
const tempPath = `${outputPath}.tmp-${process.pid}`;
const [primaryText, independentText] = await Promise.all([
  readFile(primaryPath, "utf8"), readFile(independentPath, "utf8"),
]);
const amendment = await buildS03DuplicateOverlapAmendment(
  primaryText, independentText, new Date().toISOString(), projectRoot,
);
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(tempPath, `${JSON.stringify(amendment, null, 2)}\n`, { mode: 0o600 });
await rename(tempPath, outputPath);
await chmod(outputPath, 0o600);
process.stdout.write(`${JSON.stringify({ outputPath, status: amendment.status }, null, 2)}\n`);
