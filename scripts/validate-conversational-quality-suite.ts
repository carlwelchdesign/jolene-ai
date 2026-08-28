import { readFile } from "node:fs/promises";
import path from "node:path";

import { conversationalQualitySuiteSchema } from
  "../src/evaluation/conversational-quality-evaluation.js";

const filePath = path.resolve(
  process.cwd(),
  process.argv[2] ?? "evaluations/conversational-quality-v1.json",
);
const suite = conversationalQualitySuiteSchema.parse(
  JSON.parse(await readFile(filePath, "utf8")),
);
process.stdout.write(`${JSON.stringify({
  suiteVersion: suite.suiteVersion,
  suiteId: suite.suiteId,
  caseCount: suite.cases.length,
  categories: [...new Set(suite.cases.map((item) => item.category))].sort(),
  humanReviewRequired: true,
}, null, 2)}\n`);
