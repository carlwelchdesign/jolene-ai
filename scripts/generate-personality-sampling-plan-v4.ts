import { rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { stringify } from "yaml";

import { buildPersonalitySamplingPlanV4 } from
  "../src/personality/personality-sampling-plan-v4.js";

const createdAt = process.env.JOLENE_SAMPLING_PLAN_V4_CREATED_AT;
if (!createdAt) throw new Error("JOLENE_SAMPLING_PLAN_V4_CREATED_AT is required");
const plan = await buildPersonalitySamplingPlanV4(createdAt);
const output = path.resolve(process.cwd(), "research/sampling-plan-v4.yaml");
const temporary = `${output}.${process.pid}.tmp`;
await writeFile(temporary, stringify(plan, { lineWidth: 120 }), { encoding: "utf8", mode: 0o600 });
await rename(temporary, output);
process.stdout.write(`${JSON.stringify({ allocations: plan.source_allocations }, null, 2)}\n`);
