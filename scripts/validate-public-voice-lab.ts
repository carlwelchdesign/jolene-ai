import { readFile } from "node:fs/promises";
import path from "node:path";

import { publicVoiceLabSuiteSchema } from
  "../src/evaluation/public-voice-lab-evaluation.js";

const fixturePath = path.resolve(
  process.cwd(),
  process.argv[2] ?? "evaluations/public-voice-lab-v1.json",
);
const suite = publicVoiceLabSuiteSchema.parse(
  JSON.parse(await readFile(fixturePath, "utf8")),
);
process.stdout.write(`${JSON.stringify({
  suiteId: suite.suiteId,
  cases: suite.cases.length,
  ownerOnly: suite.ownerOnly,
  humanReviewRequired: suite.humanReviewRequired,
}, null, 2)}\n`);
