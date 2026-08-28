import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { extractSelectedHtmlPersonalitySourceTexts } from
  "../src/personality/personality-selected-html-source-text.js";

export async function validateSelectedHtmlPersonalitySourceText(projectRoot = process.cwd()) {
  const selected = await extractSelectedHtmlPersonalitySourceTexts(projectRoot);
  const bySource = Object.fromEntries([...new Set(selected.map((item) => item.sourceRegisterId))]
    .map((sourceId) => [sourceId, selected.filter((item) => item.sourceRegisterId === sourceId).length]));
  return {
    selectedTurns: selected.length,
    uniqueSegmentFingerprints: new Set(selected.map((item) => item.segmentFingerprint)).size,
    bySource,
    transientSourceTextDigest: digest(selected.map((item) => item.sourceText).join("\n\0\n")),
    sourceContentStored: false,
  };
}

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = await validateSelectedHtmlPersonalitySourceText();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
