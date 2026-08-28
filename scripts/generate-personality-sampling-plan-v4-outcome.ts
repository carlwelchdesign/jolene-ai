import { rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { stringify } from "yaml";

import { buildPersonalitySamplingPlanV4Outcome } from
  "../src/personality/personality-sampling-plan-v4-outcome.js";

const evaluatedAt = process.env.JOLENE_SAMPLING_PLAN_V4_EVALUATED_AT;
if (!evaluatedAt) throw new Error("JOLENE_SAMPLING_PLAN_V4_EVALUATED_AT is required");
const outcome = await buildPersonalitySamplingPlanV4Outcome(evaluatedAt);
const output = path.resolve(process.cwd(), "research/sampling-plan-v4-outcome.yaml");
const temporary = `${output}.${process.pid}.tmp`;
await writeFile(temporary, stringify(outcome, { lineWidth: 120 }), {
  encoding: "utf8", mode: 0o600,
});
await rename(temporary, output);
process.stdout.write(`${JSON.stringify({ failure: outcome.failure }, null, 2)}\n`);
