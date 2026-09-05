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
  type PublicArtifactSource,
} from "./public-artifact-source.js";
import {
  PublicJoleneDossierArtifactSource,
} from "./public-jolene-dossier-artifact-source.js";
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
import { InMemoryPublicOperationalTelemetry } from "./public-operational-telemetry.js";
import {
  RedisRestCoordinationClient,
} from "./redis-rest-coordination-client.js";
import {
  PreflightedPublicRequestAdmission,
  SharedPublicModelRequestBudget,
  SharedPublicRequestAdmission,
} from "./shared-public-coordination.js";
import {
  SharedPublicAuditTelemetry,
  SharedSecurityTelemetry,
} from "./shared-public-observability.js";
import type { SecurityTelemetryRecorder } from "../security/security-telemetry.js";
import { personalityModeSchema } from "../personality/personality-mode.js";
import type { PublicJoleneProjectDossier } from
  "../domain/public-jolene-project-dossier.js";
import type { PublicResumeProjectDossier } from
  "../domain/public-resume-project-dossier.js";
import { PublicResumeProjectArtifactSource } from
  "./public-resume-project-artifact-source.js";
import type { PublicCareerProfileDossier } from
  "../domain/public-career-profile-dossier.js";
import { PublicCareerProfileArtifactSource } from
  "./public-career-profile-artifact-source.js";

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
  JOLENE_PERSONALITY_MODE: personalityModeSchema.default("jolene"),
  JOLENE_PUBLIC_OPENAI_MODEL: z.string().trim().min(1).default("gpt-5.6-terra"),
  JOLENE_PUBLIC_OPENAI_TIMEOUT_MS: z.coerce.number().int().min(1_000)
    .max(30_000).default(20_000),
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

const hostedCoordinationEnvironmentSchema = z.object({
  JOLENE_PUBLIC_COORDINATION_URL: z.string().url().startsWith("https://"),
  JOLENE_PUBLIC_COORDINATION_HOST: z.string().trim().min(1).max(253),
  JOLENE_PUBLIC_COORDINATION_TOKEN: z.string().trim().min(32).max(4_096),
  JOLENE_PUBLIC_COORDINATION_NAMESPACE: z.string()
    .regex(/^[a-z][a-z0-9-]{2,31}$/),
  JOLENE_PUBLIC_CLIENT_HASH_KEY: z.string().min(32).max(4_096),
  JOLENE_PUBLIC_COORDINATION_TIMEOUT_MS: z.coerce.number().int().min(250)
    .max(10_000).default(2_000),
  JOLENE_PUBLIC_COORDINATION_PREFLIGHT_FRESHNESS_MS: z.coerce.number().int()
    .min(1_000).max(300_000).default(60_000),
  JOLENE_PUBLIC_SHARED_AUDIT_RETENTION_DAYS: z.coerce.number().int().min(1)
    .max(90).default(30),
  JOLENE_PUBLIC_SHARED_AUDIT_MAX_ENTRIES: z.coerce.number().int().min(1)
    .max(10_000).default(5_000),
  JOLENE_PUBLIC_SHARED_SECURITY_RETENTION_DAYS: z.coerce.number().int().min(1)
    .max(90).default(30),
  JOLENE_PUBLIC_SHARED_SECURITY_MAX_ENTRIES: z.coerce.number().int().min(1)
    .max(10_000).default(5_000),
}).strict();

export function createVercelPublicDelegateHandler(
  environment: Record<string, string | undefined> = process.env,
  coordination?: HostedPublicCoordination,
  options: {
    readonly dossier?: PublicJoleneProjectDossier;
    readonly careerProfile?: PublicCareerProfileDossier;
    readonly resumeProjects?: PublicResumeProjectDossier;
  } = {},
) {
  const config = vercelPublicEnvironmentSchema.parse(environment);
  const hostedCoordination = coordination ?? createRedisHostedCoordination(
    environment,
    config,
  );
  let artifacts: PublicArtifactSource = new HttpsPublicArtifactSource({
    url: config.JOLENE_PUBLIC_ARTIFACT_URL,
    expectedCorpusVersion: config.JOLENE_PUBLIC_EXPECTED_CORPUS_VERSION,
    timeoutMilliseconds: config.JOLENE_PUBLIC_ARTIFACT_TIMEOUT_MS,
  });
  if (options.careerProfile) {
    artifacts = new PublicCareerProfileArtifactSource(
      artifacts,
      options.careerProfile,
    );
  }
  if (options.resumeProjects) {
    artifacts = new PublicResumeProjectArtifactSource(
      artifacts,
      options.resumeProjects,
    );
  }
  if (options.dossier) {
    artifacts = new PublicJoleneDossierArtifactSource(artifacts, options.dossier);
  }

  return createPublicDelegateRequestHandler({
    enabled: hostedCoordination?.scope === "shared",
    artifacts,
    answers: createAnswerService(
      config,
      hostedCoordination?.modelBudget ?? new FailClosedPublicModelBudget(),
    ),
    jobFit: new DeterministicPublicJobFitService(),
    contactIntents: {
      stage: async () => {
        throw new PublicContactQueueUnavailableError();
      },
    },
    admissions: hostedCoordination?.admissions ?? new FailClosedHostedAdmission(),
    ...(hostedCoordination
      ? {
          audits: hostedCoordination.audits,
          telemetry: hostedCoordination.telemetry,
        }
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
    personalityMode: config.JOLENE_PERSONALITY_MODE,
  }), {
    budget: modelBudget,
    personalityMode: config.JOLENE_PERSONALITY_MODE,
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
  readonly securityTelemetry: SecurityTelemetryRecorder;
}

export function createRedisHostedCoordination(
  environment: Record<string, string | undefined>,
  publicConfig?: z.infer<typeof vercelPublicEnvironmentSchema>,
  fetch: typeof globalThis.fetch = globalThis.fetch,
): HostedPublicCoordination | undefined {
  const parsed = hostedCoordinationEnvironmentSchema.safeParse(
    coordinationEnvironment(environment),
  );
  if (!parsed.success) return undefined;
  let client: RedisRestCoordinationClient;
  try {
    client = new RedisRestCoordinationClient({
      url: parsed.data.JOLENE_PUBLIC_COORDINATION_URL,
      token: parsed.data.JOLENE_PUBLIC_COORDINATION_TOKEN,
      allowedHosts: [parsed.data.JOLENE_PUBLIC_COORDINATION_HOST],
      namespace: parsed.data.JOLENE_PUBLIC_COORDINATION_NAMESPACE,
      timeoutMilliseconds: parsed.data.JOLENE_PUBLIC_COORDINATION_TIMEOUT_MS,
      fetch,
    });
  } catch {
    return undefined;
  }
  const config = publicConfig ?? vercelPublicEnvironmentSchema.safeParse(environment).data;
  if (!config) return undefined;
  const admissions = new SharedPublicRequestAdmission({
    client,
    clientHashKey: parsed.data.JOLENE_PUBLIC_CLIENT_HASH_KEY,
    requestsPerWindow: config.JOLENE_PUBLIC_REQUESTS_PER_MINUTE,
    maxConcurrentRequests: config.JOLENE_PUBLIC_MAX_CONCURRENT_REQUESTS,
  });
  const audits = new SharedPublicAuditTelemetry({
    client,
    maxEntries: parsed.data.JOLENE_PUBLIC_SHARED_AUDIT_MAX_ENTRIES,
    retentionMilliseconds:
      parsed.data.JOLENE_PUBLIC_SHARED_AUDIT_RETENTION_DAYS * 86_400_000,
  });
  const securityTelemetry = new SharedSecurityTelemetry({
    client,
    maxEntries: parsed.data.JOLENE_PUBLIC_SHARED_SECURITY_MAX_ENTRIES,
    retentionMilliseconds:
      parsed.data.JOLENE_PUBLIC_SHARED_SECURITY_RETENTION_DAYS * 86_400_000,
  });
  return {
    scope: "shared",
    admissions: new PreflightedPublicRequestAdmission({
      client,
      delegate: admissions,
      freshnessMilliseconds:
        parsed.data.JOLENE_PUBLIC_COORDINATION_PREFLIGHT_FRESHNESS_MS,
    }),
    modelBudget: new SharedPublicModelRequestBudget({
      client,
      maxRequestsPerWindow: config.JOLENE_PUBLIC_OPENAI_REQUESTS_PER_DAY,
      windowMilliseconds: 86_400_000,
    }),
    audits,
    telemetry: new InMemoryPublicOperationalTelemetry(),
    securityTelemetry,
  };
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

function coordinationEnvironment(environment: Record<string, string | undefined>) {
  return Object.fromEntries(Object.entries(environment).filter(([key]) =>
    key.startsWith("JOLENE_PUBLIC_COORDINATION_") ||
    key === "JOLENE_PUBLIC_CLIENT_HASH_KEY" ||
    key.startsWith("JOLENE_PUBLIC_SHARED_")
  ));
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
