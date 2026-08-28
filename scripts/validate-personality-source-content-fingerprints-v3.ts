import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { validatePersonalitySourceFingerprintsV3 } from
  "./validate-personality-source-content-fingerprints.js";

export { validatePersonalitySourceFingerprintsV3 };

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await validatePersonalitySourceFingerprintsV3();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
