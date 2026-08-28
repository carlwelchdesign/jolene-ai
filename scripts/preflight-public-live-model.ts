import { readFile } from "node:fs/promises";
import path from "node:path";

import { preflightPublicLiveModelSuite } from
  "../src/evaluation/public-live-model-preflight.js";

const suite = JSON.parse(await readFile(
  path.resolve("evaluations/public-live-model-v1.json"),
  "utf8",
));
const priorReport = JSON.parse(await readFile(
  path.resolve(".jolene/evaluations/public-live-model-report.json"),
  "utf8",
));
const report = preflightPublicLiveModelSuite(suite, priorReport);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (report.gate === "fail") process.exitCode = 1;
