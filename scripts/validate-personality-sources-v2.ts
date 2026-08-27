import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { loadPersonalitySourceRegisterV2 } from
  "../src/personality/personality-source-register.js";
import type { PersonalitySourceRegisterSnapshot } from
  "../src/personality/personality-source-register.js";

export type PersonalitySourceValidationSummary = Omit<
  PersonalitySourceRegisterSnapshot,
  "events"
>;

export async function validatePersonalitySourcesV2(
  projectRoot = process.cwd(),
): Promise<PersonalitySourceValidationSummary> {
  const { events: _events, ...summary } = await loadPersonalitySourceRegisterV2(projectRoot);
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await validatePersonalitySourcesV2();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
