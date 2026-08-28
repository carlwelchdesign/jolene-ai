import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { personalityPrimaryCodingArtifactV5Schema } from
  "../src/personality/personality-primary-coding-v5.js";
import { validatePrimaryCodingRightsV5 } from
  "../src/personality/personality-primary-coding-rights-v5.js";
import { loadPersonalitySelectionArtifactsV5 } from
  "../src/personality/personality-selection-ledgers-v5.js";
import { extractSelectedHtmlPersonalitySourceTexts } from
  "../src/personality/personality-selected-html-source-text.js";
import { extractSelectedPdfPersonalitySourceTexts } from
  "../src/personality/personality-selected-pdf-source-text.js";

export async function validatePersonalityPrimaryCodingRightsV5(projectRoot = process.cwd()) {
  const [artifactText, selection, html, pdf] = await Promise.all([
    readFile(path.resolve(projectRoot, "research/primary-coding-v5.json"), "utf8"),
    loadPersonalitySelectionArtifactsV5(projectRoot),
    extractSelectedHtmlPersonalitySourceTexts(projectRoot),
    extractSelectedPdfPersonalitySourceTexts(projectRoot),
  ]);
  const transientBySelectionId = new Map(
    [...html, ...pdf].map((item) => [item.selectionId, item]),
  );
  const ordered = selection.ledgers.flatMap((ledger) => ledger.selectedUnits.map((unit) => {
    const transient = transientBySelectionId.get(unit.selectionId);
    if (!transient || transient.segmentFingerprint !== unit.segmentFingerprint) {
      throw new Error(`Rights source input does not match ${unit.selectionId}`);
    }
    return transient;
  }));
  return validatePrimaryCodingRightsV5(
    personalityPrimaryCodingArtifactV5Schema.parse(JSON.parse(artifactText)),
    ordered,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = await validatePersonalityPrimaryCodingRightsV5();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
