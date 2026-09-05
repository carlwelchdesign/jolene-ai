import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import dotenv from "dotenv";
import OpenAI from "openai";

import {
  publicVoiceLabCapturePacketSchema,
  publicVoiceLabSuiteSchema,
  type PublicVoiceLabCapturePacket,
} from "../src/evaluation/public-voice-lab-evaluation.js";
import { publicCareerEvidenceArtifactSchema } from
  "../src/domain/public-career-evidence.js";
import { OpenAIPublicAnswerGenerator } from
  "../src/public/openai-public-answer-generator.js";
import { PublicAnswerGroundingValidator } from
  "../src/public/public-answer-grounding-validator.js";
import { parsePublicDelegateConfig } from "../src/public/public-config.js";
import { GroundedPublicAnswerService } from
  "../src/public/public-answer-service.js";

const argumentsList = process.argv.slice(2);
if (!argumentsList.includes("--live")) {
  process.stderr.write("Voice-lab capture requires the explicit --live flag.\n");
  process.exitCode = 2;
} else {
  await run().catch(() => {
    process.stderr.write("Voice-lab capture failed; no response content or credential was logged.\n");
    process.exitCode = 2;
  });
}

async function run(): Promise<void> {
  const environment = dotenv.parse(await readFile(
    path.resolve(".env.public.local"), "utf8",
  ));
  const localApiKey = await readLocalOpenAiKey();
  const config = parsePublicDelegateConfig({
    ...environment,
    OPENAI_API_KEY: environment.OPENAI_API_KEY ?? localApiKey ?? process.env.OPENAI_API_KEY,
  });
  if (config.answerMode !== "openai" || !config.openaiApiKey) {
    throw new Error("Voice-lab capture requires explicit public OpenAI configuration.");
  }
  const suite = publicVoiceLabSuiteSchema.parse(JSON.parse(await readFile(
    path.resolve(argumentValue("--fixture") ?? "evaluations/public-voice-lab-v1.json"),
    "utf8",
  )));
  const artifact = publicCareerEvidenceArtifactSchema.parse(JSON.parse(await readFile(
    path.resolve(".jolene/exports/public-career-evidence.json"), "utf8",
  )));
  let validationFailure: { reasonCode: string; segmentIndex: number | null } | undefined;
  let providerFailure: {
    category: "timeout" | "http" | "network" | "model_output" | "unknown";
  } | undefined;
  const groundingValidator = new PublicAnswerGroundingValidator();
  const generator = new OpenAIPublicAnswerGenerator({
    client: new OpenAI({ apiKey: config.openaiApiKey }),
    model: config.openaiModel,
    timeoutMilliseconds: config.openaiTimeoutMilliseconds,
    personalityMode: "jolene",
  });
  const answers = new GroundedPublicAnswerService({
    generate: async (input) => {
      try {
        return await generator.generate(input);
      } catch (error) {
        providerFailure = { category: classifyProviderFailure(error) };
        throw error;
      }
    },
  }, {
    personalityMode: "jolene",
    validator: {
      validate: (candidateArtifact, baseline, generation) => {
        const validation = groundingValidator.validate(
          candidateArtifact,
          baseline,
          generation,
        );
        validationFailure = validation.audit.status === "rejected"
          ? {
            reasonCode: validation.audit.reasonCode,
            segmentIndex: validation.audit.segmentIndex,
          }
          : undefined;
        return validation;
      },
    },
  });
  const output = path.resolve(argumentValue("--packet") ??
    ".jolene/evaluations/public-voice-lab-capture.json");
  const selectedCaseId = argumentValue("--case");
  const selectedCases = selectedCaseId
    ? suite.cases.filter((item) => item.id === selectedCaseId)
    : suite.cases;
  if (selectedCaseId && selectedCases.length === 0) {
    throw new Error("Selected voice-lab case is not in the suite.");
  }
  const cases: PublicVoiceLabCapturePacket["cases"] = [];
  for (const testCase of selectedCases) {
    validationFailure = undefined;
    providerFailure = undefined;
    const execution = await answers.execute(artifact, { question: testCase.prompt });
    cases.push({
      id: testCase.id,
      prompt: testCase.prompt,
      register: testCase.register,
      mode: execution.mode === "model" || execution.mode === "deterministic"
        ? execution.mode : "fallback" as const,
      executionMode: execution.mode,
      answer: execution.response.answer,
      citationIds: execution.response.citations.map((citation) => citation.evidenceId),
      validationFailure,
      providerFailure,
    });
  }
  const prior = selectedCaseId
    ? publicVoiceLabCapturePacketSchema.parse(JSON.parse(await readFile(output, "utf8")))
    : undefined;
  const packet = publicVoiceLabCapturePacketSchema.parse({
    suiteVersion: suite.suiteVersion,
    suiteId: suite.suiteId,
    capturedAt: new Date().toISOString(),
    model: config.openaiModel,
    ownerOnly: true,
    humanReviewRequired: true,
    cases: prior
      ? prior.cases.map((item) => cases.find((candidate) => candidate.id === item.id) ?? item)
      : cases,
  });
  await mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
  const temporary = `${output}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(packet, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, output);
  process.stdout.write(`${JSON.stringify({ suiteId: packet.suiteId, cases: packet.cases.length, model: packet.model, packet: output }, null, 2)}\n`);
}

function classifyProviderFailure(
  error: unknown,
): "timeout" | "http" | "network" | "model_output" | "unknown" {
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return "timeout";
  }
  if (typeof error !== "object" || error === null) return "unknown";
  const candidate = error as {
    readonly name?: unknown;
    readonly code?: unknown;
    readonly status?: unknown;
  };
  if (typeof candidate.status === "number") return "http";
  const code = `${candidate.name ?? ""} ${candidate.code ?? ""}`.toLowerCase();
  if (
    code.includes("zod") ||
    code.includes("schema") ||
    code.includes("parse") ||
    code.includes("syntaxerror")
  ) {
    return "model_output";
  }
  if (code.includes("timeout") || code.includes("abort")) return "timeout";
  if (code.includes("network") || code.includes("connect")) return "network";
  return "unknown";
}

async function readLocalOpenAiKey(): Promise<string | undefined> {
  for (const candidate of [".env.local", ".env"]) {
    try {
      const environment = dotenv.parse(await readFile(path.resolve(candidate), "utf8"));
      if (environment.OPENAI_API_KEY) return environment.OPENAI_API_KEY;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return undefined;
}

function argumentValue(name: string): string | undefined {
  const index = argumentsList.indexOf(name);
  if (index === -1) return undefined;
  const value = argumentsList[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
  return value;
}
