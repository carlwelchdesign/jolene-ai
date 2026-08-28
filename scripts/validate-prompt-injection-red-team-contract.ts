import { readFile } from "node:fs/promises";

import { promptInjectionRedTeamSuiteSchema } from
  "../src/evaluation/prompt-injection-red-team-contract.js";

const source = new URL(
  "../evaluations/prompt-injection-red-team-contract-v1.json",
  import.meta.url,
);
const suite = promptInjectionRedTeamSuiteSchema.parse(
  JSON.parse(await readFile(source, "utf8")),
);

process.stdout.write(`${JSON.stringify({
  schemaVersion: suite.schemaVersion,
  suiteVersion: suite.suiteVersion,
  suiteId: suite.suiteId,
  cases: suite.cases.length,
  gateThresholdBps: 10_000,
})}\n`);
