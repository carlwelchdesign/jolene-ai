import { loadPersonalityPreallocationCapacityManifestV1 } from
  "../src/personality/personality-preallocation-capacity-manifest.js";

process.stdout.write(`${JSON.stringify(
  await loadPersonalityPreallocationCapacityManifestV1(), null, 2,
)}\n`);
