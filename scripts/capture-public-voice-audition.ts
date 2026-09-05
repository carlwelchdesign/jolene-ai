import { mkdir, rename, writeFile, readFile } from "node:fs/promises";
import path from "node:path";

import dotenv from "dotenv";
import OpenAI from "openai";
import { z } from "zod";

import {
  PUBLIC_VOICE_AUDITION_CASES,
  PUBLIC_VOICE_AUDITION_VERSION,
  publicVoiceAuditionCandidateSchema,
  publicVoiceAuditionCaseResultSchema,
  publicVoiceAuditionPacketSchema,
} from "../src/evaluation/public-voice-audition.js";
import { publicCareerEvidenceArtifactSchema } from
  "../src/domain/public-career-evidence.js";
import { DeterministicPublicAnswerService } from
  "../src/public/public-answer-service.js";
import {
  ORIGINAL_JOLENE_PERFORMANCE_STANDARD,
  ORIGINAL_JOLENE_VOICE_ANCHORS,
} from
  "../src/personality/original-jolene-character-system.js";

const ORIGINAL_JOLENE_WRITING_STANDARD = [
  ...ORIGINAL_JOLENE_PERFORMANCE_STANDARD,
  "These original, fact-free examples demonstrate rhythm only. Never repeat, paraphrase closely, or treat them as evidence:",
  ...ORIGINAL_JOLENE_VOICE_ANCHORS,
  "She treats Carl as a person she roots for, not a pile of credentials. Build the answer around one concrete tension in the question, then use the supplied facts to settle it.",
  "Avoid these dead résumé phrases entirely: 'strong fit,' 'steady delivery,' 'product judgment,' 'connects design and engineering,' 'complex product work,' 'that’s why the case,' and 'helps teams.'",
].join(" ");

const outputSchema = z.object({
  candidates: z.array(publicVoiceAuditionCandidateSchema).length(3),
}).strict();

const requestedCaseId = optionValue("--case");
const assembling = process.argv.includes("--assemble");

if (requestedCaseId && assembling) {
  process.stderr.write("Use either --case or --assemble, not both.\n");
  process.exitCode = 2;
} else if (assembling) {
  await assemble().catch(reportFailure);
} else if (!process.argv.includes("--live")) {
  process.stderr.write("Voice audition requires the explicit --live flag.\n");
  process.exitCode = 2;
} else {
  await run(requestedCaseId).catch(reportFailure);
}

async function run(caseId?: string): Promise<void> {
  const environment = await loadEnvironment();
  const model = required(environment, "JOLENE_PUBLIC_OPENAI_MODEL");
  const timeoutMilliseconds = Number(required(environment, "JOLENE_PUBLIC_OPENAI_TIMEOUT_MS"));
  const client = new OpenAI({ apiKey: required(environment, "OPENAI_API_KEY") });
  const artifact = publicCareerEvidenceArtifactSchema.parse(JSON.parse(await readFile(
    path.resolve(".jolene/exports/public-career-evidence.json"), "utf8",
  )));
  const baselineAnswers = new DeterministicPublicAnswerService();
  const selectedCases = caseId
    ? PUBLIC_VOICE_AUDITION_CASES.filter((item) => item.id === caseId)
    : PUBLIC_VOICE_AUDITION_CASES;
  if (caseId && selectedCases.length !== 1) {
    throw new Error(`Unknown voice audition case: ${caseId}`);
  }
  const cases = [];
  for (const item of selectedCases) {
    const baseline = baselineAnswers.answer(artifact, { question: item.prompt });
    const response = await client.responses.create({
      model,
      store: false,
      input: JSON.stringify({
        question: item.prompt,
        register: item.register,
        approvedFacts: baseline.claims.map((claim) => claim.text),
        factualClaims: baseline.claims.map((claim) => claim.text),
      }),
      max_output_tokens: 900,
      reasoning: { effort: "none" },
      instructions: [
        ORIGINAL_JOLENE_WRITING_STANDARD,
        "Write for an original fictional portfolio guide named Jolene.",
        "Return three distinctly different performance options for the supplied question.",
        "Each option is a compact complete answer: a one-sentence opening, one or two evidence-backed middle sentences, and one-sentence closing. Keep every sentence short and concrete. The combined three fields must stay under 140 words.",
        "Use only the supplied approved facts for factual claims. Do not add credentials, outcomes, biography, or inferred team value.",
        "The opening is a compact spoken joke or mischievous observation about the actual question. It must feel human and particular, not random, surreal, or metaphor-first.",
        "Write warm, candid, lively conversation. Avoid corporate prose, motivational language, fairy-tale scenes, random household objects, decorative metaphors, credential lists, and conclusion slogans.",
        "Do not start with 'instead', 'rather', 'a question', 'the useful', 'the answer', 'Carl's', or 'hiring'. Do not use 'less like', 'more like', 'flip the view', 'turn the page', or 'at first'.",
        "The closing should return naturally to the question without an invitation, promise, call to action, or slogan.",
        "Use each mechanic exactly once, but never name the mechanic or make it feel like a writing exercise: playful_comparison, literal_flip, small_story_turn.",
        "Do not imitate or name a real person, use dialect performance, quote anyone, use numbers, or mention providers or technologies.",
        "Original rhythm examples only; never repeat them: 'A résumé is a strange little courtroom: everybody arrives polished and nobody brings folding chairs.' 'RAG is the moment a chatbot stops rummaging through its attic and checks the labeled boxes.'",
        "Return only the required JSON object.",
      ].join(" "),
      text: {
        format: {
          type: "json_schema",
          name: "original_jolene_voice_audition",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              candidates: {
                type: "array", minItems: 3, maxItems: 3,
                items: {
                  type: "object", additionalProperties: false,
                  properties: {
                    id: { type: "string", enum: ["a", "b", "c"] },
                    mechanic: { type: "string", enum: ["playful_comparison", "literal_flip", "small_story_turn"] },
                    opening: { type: "string", minLength: 8, maxLength: 240 },
                    answer: { type: "string", minLength: 80, maxLength: 2000 },
                    closing: { type: "string", minLength: 8, maxLength: 240 },
                  },
                  required: ["id", "mechanic", "opening", "answer", "closing"],
                },
              },
            },
            required: ["candidates"],
          },
        },
      },
    }, { signal: AbortSignal.timeout(timeoutMilliseconds) });
    if (response.status !== "completed") {
      throw new Error(`Provider returned an incomplete audition response: ${response.incomplete_details?.reason ?? response.status}`);
    }
    const result = publicVoiceAuditionCaseResultSchema.parse({
      ...item,
      ...outputSchema.parse(JSON.parse(response.output_text)),
    });
    await writeCaseResult(result);
    cases.push(result);
  }
  if (caseId) {
    process.stdout.write(`${JSON.stringify({ case: caseId, model, saved: caseDestination(caseId) }, null, 2)}\n`);
    return;
  }
  await writePacket(cases, model);
}

async function assemble(): Promise<void> {
  const environment = await loadEnvironment();
  const model = required(environment, "JOLENE_PUBLIC_OPENAI_MODEL");
  const cases = await Promise.all(PUBLIC_VOICE_AUDITION_CASES.map(async (item) => publicVoiceAuditionCaseResultSchema.parse(JSON.parse(await readFile(
    caseDestination(item.id), "utf8",
  )))));
  await writePacket(cases, model);
}

async function writePacket(cases: unknown[], model: string): Promise<void> {
  const packet = publicVoiceAuditionPacketSchema.parse({
    version: PUBLIC_VOICE_AUDITION_VERSION,
    capturedAt: new Date().toISOString(),
    model,
    ownerOnly: true,
    cases,
  });
  const destination = path.resolve(".jolene/evaluations/public-voice-audition.json");
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = `${destination}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(packet, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, destination);
  process.stdout.write(`${JSON.stringify({ cases: packet.cases.length, model: packet.model, packet: destination }, null, 2)}\n`);
}

async function writeCaseResult(result: z.infer<typeof publicVoiceAuditionCaseResultSchema>): Promise<void> {
  const destination = caseDestination(result.id);
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = `${destination}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, destination);
}

function caseDestination(caseId: string): string {
  return path.resolve(".jolene/evaluations/public-voice-audition-runs", `${caseId.replace(/^audition:/, "")}.json`);
}

function optionValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
  return value;
}

function reportFailure(error: unknown): void {
  const candidate = error as { readonly name?: unknown; readonly message?: unknown; readonly status?: unknown };
  process.stderr.write(`${JSON.stringify({
    event: "public_voice_audition_failed",
    case: requestedCaseId,
    name: typeof candidate?.name === "string" ? candidate.name : "unknown",
    status: typeof candidate?.status === "number" ? candidate.status : undefined,
    message: typeof candidate?.message === "string" ? candidate.message.slice(0, 240) : "unknown",
  })}\n`);
  process.exitCode = 2;
}

async function loadEnvironment(): Promise<Record<string, string>> {
  const publicEnvironment = dotenv.parse(await readFile(path.resolve(".env.public.local"), "utf8"));
  let localEnvironment: Record<string, string> = {};
  try { localEnvironment = dotenv.parse(await readFile(path.resolve(".env.local"), "utf8")); } catch { /* optional */ }
  let baseEnvironment: Record<string, string> = {};
  try { baseEnvironment = dotenv.parse(await readFile(path.resolve(".env"), "utf8")); } catch { /* optional */ }
  return { ...baseEnvironment, ...localEnvironment, ...publicEnvironment, ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")) };
}

function required(environment: Record<string, string>, key: string): string {
  const value = environment[key]?.trim();
  if (!value) throw new Error(`${key} is required for a live voice audition.`);
  return value;
}
