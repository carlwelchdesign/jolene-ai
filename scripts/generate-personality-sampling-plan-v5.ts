import { chmod, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { stringify } from "yaml";

import { buildPersonalitySamplingPlanV5 } from
  "../src/personality/personality-sampling-plan-v5.js";

const createdAt = process.env.JOLENE_SAMPLING_PLAN_V5_CREATED_AT;
if (!createdAt) throw new Error("JOLENE_SAMPLING_PLAN_V5_CREATED_AT is required");
const plan = await buildPersonalitySamplingPlanV5(createdAt);
const output = path.resolve("research/sampling-plan-v5.yaml");
const temporary = `${output}.${process.pid}.tmp`;
await writeFile(temporary, stringify(plan, { lineWidth: 120 }), { encoding: "utf8", mode: 0o600 });
await rename(temporary, output);
await chmod(output, 0o600);
process.stdout.write(`${JSON.stringify({ output, allocations: plan.source_allocations }, null, 2)}\n`);
