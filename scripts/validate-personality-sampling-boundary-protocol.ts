import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { loadPersonalitySamplingBoundaryProtocolV1 } from
  "../src/personality/personality-sampling-boundary-protocol.js";

export async function validatePersonalitySamplingBoundaryProtocol(projectRoot = process.cwd()) {
  return loadPersonalitySamplingBoundaryProtocolV1(projectRoot);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await validatePersonalitySamplingBoundaryProtocol();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
