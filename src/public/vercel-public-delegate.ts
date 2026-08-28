import type { IncomingMessage } from "node:http";

import OpenAI from "openai";
import { z } from "zod";

import {
  DeterministicPublicAnswerService,
  GroundedPublicAnswerService,
  type PublicPortfolioAnswerer,
} from "./public-answer-service.js";
import {
  HttpsPublicArtifactSource,
} from "./public-artifact-source.js";
import {
  createPublicDelegateRequestHandler,
} from "./public-delegate-server.js";
import { DeterministicPublicJobFitService } from "./public-job-fit-service.js";
import { OpenAIPublicAnswerGenerator } from "./openai-public-answer-generator.js";
import { OpenAIPublicEmbeddingProvider } from
  "./openai-public-embedding-provider.js";
import { HybridPublicEvidenceRetriever } from
  "./public-hybrid-evidence-retriever.js";
import type { PublicModelRequestBudget } from
  "./public-model-request-budget.js";
import type { PublicRequestAdmissionController } from "./public-request-admission.js";
import type { PublicAuditRecorder } from "./public-audit-ledger.js";
import { PublicContactQueueUnavailableError } from "./public-contact-intent-queue.js";
import type { PublicOperationalTelemetry } from "./public-operational-telemetry.js";

const vercelPublicEnvironmentSchema = z.object({
  JOLENE_PUBLIC_ENABLED: z.literal("true"),
  JOLENE_PUBLIC_AUTH_MODE: z.literal("bearer"),
  JOLENE_PUBLIC_API_TOKEN: z.string().trim().min(32),
  JOLENE_PUBLIC_ARTIFACT_URL: z.string().url().startsWith("https://"),
  JOLENE_PUBLIC_EXPECTED_CORPUS_VERSION: z.string()
    .regex(/^career:[a-f0-9]{64}$/),
  JOLENE_PUBLIC_ARTIFACT_TIMEOUT_MS: z.coerce.number().int().min(1_000)
    .max(30_000).default(5_000),
  JOLENE_PUBLIC_REQUESTS_PER_MINUTE: z.coerce.number().int().min(1).max(600)
    .default(60),
  JOLENE_PUBLIC_MAX_CONCURRENT_REQUESTS: z.coerce.number().int().min(1).max(64)
    .default(8),
  JOLENE_PUBLIC_ANSWER_MODE: z.enum(["deterministic", "openai"])
    .default("deterministic"),
  JOLENE_PUBLIC_OPENAI_MODEL: z.string().trim().min(1).default("gpt-5.4-mini"),
  JOLENE_PUBLIC_OPENAI_TIMEOUT_MS: z.coerce.number().int().min(1_000)
    .max(30_000).default(12_000),
  JOLENE_PUBLIC_OPENAI_REQUESTS_PER_DAY: z.coerce.number().int().min(1)
    .max(10_000).default(500),
  JOLENE_PUBLIC_RETRIEVAL_MODE: z.enum(["deterministic", "hybrid"])
    .default("deterministic"),
  JOLENE_PUBLIC_OPENAI_EMBEDDING_MODEL: z.string().trim().min(1)
    .default("text-embedding-3-small"),
  OPENAI_API_KEY: z.preprocess(
    (value) => typeof value === "string" && value.trim() === ""
      ? undefined
      : value,
    z.string().trim().min(1).optional(),
  ),
}).superRefine((environment, context) => {
  if (
    environment.JOLENE_PUBLIC_ANSWER_MODE === "openai" &&
    !environment.OPENAI_API_KEY
  ) {
    context.addIssue({
      code: "custom",
      path: ["OPENAI_API_KEY"],
      message: "OPENAI_API_KEY is required when public answer mode is openai.",
    });
  }
  if (
    environment.JOLENE_PUBLIC_RETRIEVAL_MODE === "hybrid" &&
    environment.JOLENE_PUBLIC_ANSWER_MODE !== "openai"
  ) {
    context.addIssue({
      code: "custom",
      path: ["JOLENE_PUBLIC_RETRIEVAL_MODE"],
      message: "Hybrid public retrieval requires OpenAI answer mode.",
    });
  }
});

export function createVercelPublicDelegateHandler(
  environment: Record<string, string | undefined> = process.env,
  coordination?: HostedPublicCoordination,
) {
  const config = vercelPublicEnvironmentSchema.parse(environment);
  const artifacts = new HttpsPublicArtifactSource({
    url: config.JOLENE_PUBLIC_ARTIFACT_URL,
    expectedCorpusVersion: config.JOLENE_PUBLIC_EXPECTED_CORPUS_VERSION,
    timeoutMilliseconds: config.JOLENE_PUBLIC_ARTIFACT_TIMEOUT_MS,
  });

  return createPublicDelegateRequestHandler({
    enabled: coordination?.scope === "shared",
    artifacts,
    answers: createAnswerService(
      config,
      coordination?.modelBudget ?? new FailClosedPublicModelBudget(),
    ),
    jobFit: new DeterministicPublicJobFitService(),
    contactIntents: {
      stage: async () => {
        throw new PublicContactQueueUnavailableError();
      },
    },
    admissions: coordination?.admissions ?? new FailClosedHostedAdmission(),
    ...(coordination
      ? { audits: coordination.audits, telemetry: coordination.telemetry }
      : {}),
    clientKey: vercelClientKey,
    apiToken: config.JOLENE_PUBLIC_API_TOKEN,
  });
}

function createAnswerService(
  config: z.infer<typeof vercelPublicEnvironmentSchema>,
  modelBudget: PublicModelRequestBudget,
): PublicPortfolioAnswerer {
  if (config.JOLENE_PUBLIC_ANSWER_MODE === "deterministic") {
    return new DeterministicPublicAnswerService();
  }
  return new GroundedPublicAnswerService(new OpenAIPublicAnswerGenerator({
    client: new OpenAI({ apiKey: requireOpenAIApiKey(config.OPENAI_API_KEY) }),
    model: config.JOLENE_PUBLIC_OPENAI_MODEL,
    timeoutMilliseconds: config.JOLENE_PUBLIC_OPENAI_TIMEOUT_MS,
  }), {
    budget: modelBudget,
    ...(config.JOLENE_PUBLIC_RETRIEVAL_MODE === "hybrid"
      ? {
        retriever: new HybridPublicEvidenceRetriever(
          new OpenAIPublicEmbeddingProvider(
            config.JOLENE_PUBLIC_OPENAI_EMBEDDING_MODEL,
            requireOpenAIApiKey(config.OPENAI_API_KEY),
          ),
        ),
      }
      : {}),
  });
}

export interface HostedPublicCoordination {
  readonly scope: "shared";
  readonly admissions: PublicRequestAdmissionController;
  readonly modelBudget: PublicModelRequestBudget;
  readonly audits: PublicAuditRecorder;
  readonly telemetry: PublicOperationalTelemetry;
}

class FailClosedHostedAdmission implements PublicRequestAdmissionController {
  acquire() {
    return {
      accepted: false as const,
      status: 503 as const,
      code: "public_delegate_busy" as const,
      retryAfterSeconds: 60,
    };
  }
}

class FailClosedPublicModelBudget implements PublicModelRequestBudget {
  async reserve(): Promise<boolean> {
    return false;
  }
}

function requireOpenAIApiKey(value: string | undefined): string {
  if (!value) throw new Error("Public OpenAI mode requires an API key.");
  return value;
}

function vercelClientKey(request: IncomingMessage): string {
  const forwarded = request.headers["x-forwarded-for"];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return value?.split(",", 1)[0]?.trim() ||
    request.socket.remoteAddress ||
    "unknown";
}
