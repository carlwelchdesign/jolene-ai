import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const python = process.env.JOLENE_PDF_PYTHON ??
  "/Users/carl.welch/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3";
const { stdout } = await execFileAsync(
  python,
  ["scripts/extract-personality-selected-pdf-source-text.py"],
  { cwd: process.cwd(), maxBuffer: 8 * 1024 * 1024 },
);
const artifact = JSON.parse(stdout);
if (artifact.schemaVersion !== "jolene.transient-selected-pdf-source-text.v1" ||
    artifact.sourceContentStored !== false || artifact.selected.length !== 38) {
  throw new Error("Transient PDF selection contract failed");
}
const bySource = Object.fromEntries([...new Set(artifact.selected.map((item) => item.sourceRegisterId))]
  .map((sourceId) => [sourceId, artifact.selected.filter((item) => item.sourceRegisterId === sourceId).length]));
process.stdout.write(`${JSON.stringify({
  selectedTurns: artifact.selected.length,
  uniqueSegmentFingerprints: new Set(artifact.selected.map((item) => item.segmentFingerprint)).size,
  bySource,
  transientSourceTextDigest: `sha256:${createHash("sha256")
    .update(artifact.selected.map((item) => item.sourceText).join("\n\0\n")).digest("hex")}`,
  sourceContentStored: false,
}, null, 2)}\n`);
