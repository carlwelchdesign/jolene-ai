import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { buildS03UniqueCapacityView } from
  "../src/personality/personality-s03-unique-capacity-view.js";

const outputPath = path.resolve("research/s03-unique-capacity-view-v1.json");
const temporaryPath = `${outputPath}.tmp-${process.pid}`;
const view = await buildS03UniqueCapacityView(new Date().toISOString());
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(temporaryPath, `${JSON.stringify(view, null, 2)}\n`, { mode: 0o600 });
await rename(temporaryPath, outputPath);
await chmod(outputPath, 0o600);
process.stdout.write(`${JSON.stringify({ outputPath, counts: view.counts }, null, 2)}\n`);
