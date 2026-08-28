import { rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { stringify } from "yaml";

import { buildPersonalityPreallocationCapacityManifestV1 } from
  "../src/personality/personality-preallocation-capacity-manifest.js";

const frozenAt = process.env.JOLENE_CAPACITY_MANIFEST_FROZEN_AT;
if (!frozenAt) throw new Error("JOLENE_CAPACITY_MANIFEST_FROZEN_AT is required");
const output = path.resolve(process.cwd(), "research/preallocation-capacity-manifest-v1.yaml");
const manifest = await buildPersonalityPreallocationCapacityManifestV1(frozenAt);
const temporary = `${output}.${process.pid}.tmp`;
await writeFile(temporary, stringify(manifest, { lineWidth: 120 }), {
  encoding: "utf8", mode: 0o600,
});
await rename(temporary, output);
process.stdout.write(`${JSON.stringify({ totals: manifest.totals }, null, 2)}\n`);
