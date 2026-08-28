import { loadPersonalitySelectionArtifactsV5 } from
  "../src/personality/personality-selection-ledgers-v5.js";

const result = await loadPersonalitySelectionArtifactsV5();
process.stdout.write(`${JSON.stringify({
  schemaVersion: result.schemaVersion,
  manifestFingerprint: result.manifestFingerprint,
  totals: result.totals,
  sourceContentStored: result.sourceContentStored,
  observationCodingPerformed: result.observationCodingPerformed,
  runtimeActivation: result.runtimeActivation,
}, null, 2)}\n`);
