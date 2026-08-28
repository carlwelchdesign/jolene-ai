import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import { z } from "zod";

const execFileAsync = promisify(execFile);

const transientPdfSelectionSchema = z.object({
  schemaVersion: z.literal("jolene.transient-selected-pdf-source-text.v1"),
  sourceContentStored: z.literal(false),
  selected: z.array(z.object({
    selectionId: z.string().regex(/^SEL-S\d{2}-\d{4}$/u),
    sourceRegisterId: z.enum(["S04", "S08", "S09", "S18"]),
    sourceEventId: z.string().regex(/^E\d{3}$/u),
    locatorLabel: z.string().min(1),
    selectionRuleId: z.enum(["SAM-001", "SAM-002"]),
    agreedHighRiskStrata: z.array(z.string().min(1)),
    segmentFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    sourceText: z.string().min(1),
  }).strict()).length(38),
}).strict();

export type TransientSelectedPdfPersonalitySourceText = z.infer<
  typeof transientPdfSelectionSchema
>["selected"][number];

export async function extractSelectedPdfPersonalitySourceTexts(
  projectRoot = process.cwd(),
  options: {
    readonly pythonPath?: string;
    readonly extractorPath?: string;
  } = {},
): Promise<readonly TransientSelectedPdfPersonalitySourceText[]> {
  const pythonPath = options.pythonPath ?? process.env.JOLENE_PDF_PYTHON ??
    "/Users/carl.welch/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3";
  const extractorPath = options.extractorPath ?? path.resolve(
    projectRoot,
    "scripts/extract-personality-selected-pdf-source-text.py",
  );
  const { stdout } = await execFileAsync(pythonPath, [extractorPath], {
    cwd: projectRoot,
    maxBuffer: 8 * 1024 * 1024,
  });
  const artifact = transientPdfSelectionSchema.parse(JSON.parse(stdout));
  if (new Set(artifact.selected.map((item) => item.segmentFingerprint)).size !== 38) {
    throw new Error("Transient PDF primary-coding selections are duplicated");
  }
  return artifact.selected;
}
