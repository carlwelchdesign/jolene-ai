import { writePersonalitySelectionArtifactsV5 } from
  "../src/personality/personality-selection-ledgers-v5.js";

const frozenAt = process.env.JOLENE_SELECTION_V5_FROZEN_AT;
if (!frozenAt) throw new Error("JOLENE_SELECTION_V5_FROZEN_AT is required");
const artifacts = await writePersonalitySelectionArtifactsV5(frozenAt);
process.stdout.write(`${JSON.stringify({ totals: artifacts.manifest.totals }, null, 2)}\n`);
