import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { stringify } from "yaml";

import { buildPersonalitySelectionArtifactsV4 } from
  "../src/personality/personality-selection-ledgers-v4.js";

const frozenAt = process.env.JOLENE_SELECTION_V4_FROZEN_AT;
if (!frozenAt) throw new Error("JOLENE_SELECTION_V4_FROZEN_AT is required");
const artifacts = await buildPersonalitySelectionArtifactsV4(frozenAt);
const outputRoot = path.resolve(process.cwd(), "research/selection-ledgers-v4");
await mkdir(outputRoot, { recursive: true });
const outputs = [
  ...artifacts.ledgerTexts.map((ledger) => ({
    path: path.resolve(outputRoot, `source-${ledger.sourceId}.json`), text: ledger.text,
  })),
  {
    path: path.resolve(process.cwd(), "research/selection-manifest-v4.yaml"),
    text: stringify(artifacts.manifest, { lineWidth: 120 }),
  },
];
for (const output of outputs) {
  const temporary = `${output.path}.${process.pid}.tmp`;
  await writeFile(temporary, output.text, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, output.path);
}
process.stdout.write(`${JSON.stringify({ totals: artifacts.manifest.totals }, null, 2)}\n`);
