import { readFile } from "node:fs/promises";
import path from "node:path";

import dotenv from "dotenv";
import OpenAI from "openai";

import {
  evaluatePublicLiveModelSuite,
  publicLiveModelEvaluationSuiteSchema,
} from "../src/evaluation/public-live-model-evaluation.js";
import { writePublicLiveModelReviewPacket } from
  "../src/evaluation/public-live-model-review-packet.js";
import { parsePublicDelegateConfig } from "../src/public/public-config.js";
import { OpenAIPublicAnswerGenerator } from
  "../src/public/openai-public-answer-generator.js";

const argumentsList = process.argv.slice(2);
if (!argumentsList.includes("--live")) {
  process.stderr.write(
    "Live public-model evaluation requires the explicit --live flag.\n",
  );
  process.exitCode = 2;
} else {
  await run().catch(() => {
    process.stderr.write(
      "Live public-model evaluation could not run; check the public-only configuration and fixture.\n",
    );
    process.exitCode = 2;
  });
}

async function run(): Promise<void> {
  const fixturePath = path.resolve(
    process.cwd(),
    argumentValue("--fixture") ?? "evaluations/public-live-model-v1.json",
  );
  const reviewPacketPath = path.resolve(
    process.cwd(),
    argumentValue("--review-packet") ??
      ".jolene/evaluations/public-live-model-review.json",
  );
  const publicEnvironmentPath = path.resolve(process.cwd(), ".env.public.local");
  const publicEnvironment = dotenv.parse(
    await readFile(publicEnvironmentPath, "utf8"),
  );
  const config = parsePublicDelegateConfig(publicEnvironment);
  if (config.answerMode !== "openai" || !config.openaiApiKey) {
    throw new Error("The separate public environment must explicitly enable OpenAI.");
  }
  const fixture = publicLiveModelEvaluationSuiteSchema.parse(
    JSON.parse(await readFile(fixturePath, "utf8")),
  );
  if (config.openaiModel !== fixture.model) {
    throw new Error("The configured public model does not match the reviewed suite.");
  }
  const generator = new OpenAIPublicAnswerGenerator({
    client: new OpenAI({ apiKey: config.openaiApiKey }),
    model: config.openaiModel,
    timeoutMilliseconds: config.openaiTimeoutMilliseconds,
    maxOutputTokens: fixture.budgets.maxOutputTokensPerRequest,
  });
  const result = await evaluatePublicLiveModelSuite(fixture, generator);
  await writePublicLiveModelReviewPacket(reviewPacketPath, result.reviewPacket);
  process.stdout.write(`${JSON.stringify(result.report, null, 2)}\n`);
  if (result.report.gate === "fail") process.exitCode = 1;
}

function argumentValue(name: string): string | undefined {
  const index = argumentsList.indexOf(name);
  if (index === -1) return undefined;
  const value = argumentsList[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}
