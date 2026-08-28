import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { parse } from "yaml";

import { validatePreallocationBoundaryDraft } from
  "../src/personality/personality-preallocation-boundary-draft.js";
import { buildHtmlLedgerFingerprintMap } from
  "../src/personality/personality-html-ledger-fingerprint-map.js";
import { loadPersonalitySamplingBoundaryProtocolV1 } from
  "../src/personality/personality-sampling-boundary-protocol.js";
import { loadPersonalitySourceRegisterV3 } from
  "../src/personality/personality-source-register-v3.js";

const sourceIds = ["S02", "S03", "S05", "S13", "S19", "S20"] as const;
const projectRoot = process.cwd();
const [register, protocol] = await Promise.all([
  loadPersonalitySourceRegisterV3(projectRoot),
  loadPersonalitySamplingBoundaryProtocolV1(projectRoot),
]);
const outputRoot = path.resolve(projectRoot, "research/html-ledger-fingerprint-maps-v1");
const outputs: Array<{ path: string; text: string }> = [];
for (const sourceId of sourceIds) {
  const draftPath = path.resolve(
    projectRoot, "research/preallocation-boundary-drafts-v1", `source-${sourceId}.yaml`,
  );
  const draftText = await readFile(draftPath, "utf8");
  const draft = parse(draftText);
  validatePreallocationBoundaryDraft(register, protocol, draft);
  const map = buildHtmlLedgerFingerprintMap(draft, draftText);
  outputs.push({
    path: path.resolve(outputRoot, `source-${sourceId}.json`),
    text: `${JSON.stringify(map, null, 2)}\n`,
  });
}
await mkdir(outputRoot, { recursive: true });
for (const output of outputs) {
  const temporary = `${output.path}.${process.pid}.tmp`;
  await writeFile(temporary, output.text, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, output.path);
}
process.stdout.write(`${JSON.stringify({ generatedMaps: outputs.length }, null, 2)}\n`);
