import { readFile } from "node:fs/promises";

import {
  promptInjectionRedTeamSuiteSchema,
  validatePromptInjectionCrossChannelCoverage,
} from
  "../src/evaluation/prompt-injection-red-team-contract.js";

const contractSource = new URL(
  "../evaluations/prompt-injection-red-team-contract-v1.json",
  import.meta.url,
);
const crossChannelSource = new URL(
  "../evaluations/prompt-injection-cross-channel-v1.json",
  import.meta.url,
);
const contract = promptInjectionRedTeamSuiteSchema.parse(
  JSON.parse(await readFile(contractSource, "utf8")),
);
const crossChannel = validatePromptInjectionCrossChannelCoverage(
  JSON.parse(await readFile(crossChannelSource, "utf8")),
);

process.stdout.write(`${JSON.stringify({
  schemaVersion: contract.schemaVersion,
  contractVersion: contract.suiteVersion,
  crossChannelVersion: crossChannel.suiteVersion,
  crossChannelCases: crossChannel.cases.length,
  surfaces: new Set(crossChannel.cases.map(({ surface }) => surface)).size,
  attackFamilies: new Set(crossChannel.cases.map(({ family }) => family)).size,
  gateThresholdBps: 10_000,
})}\n`);
