import path from "node:path";
import { isIP } from "node:net";

import dotenv from "dotenv";
import { z } from "zod";

const publicEnvSchema = z.object({
  JOLENE_PUBLIC_ENABLED: z.enum(["true", "false"]).default("true"),
  JOLENE_PUBLIC_HOST: z
    .enum(["127.0.0.1", "::1", "localhost", "0.0.0.0"])
    .default("127.0.0.1"),
  JOLENE_PUBLIC_CONTAINER_MODE: z.enum(["true", "false"]).default("false"),
  JOLENE_PUBLIC_PORT: z.coerce.number().int().min(1).max(65_535).default(8431),
  JOLENE_PUBLIC_OPERATIONS_HOST: z
    .enum(["127.0.0.1", "::1", "localhost", "0.0.0.0"])
    .default("127.0.0.1"),
  JOLENE_PUBLIC_OPERATIONS_PORT: z.coerce.number().int().min(1).max(65_535)
    .default(8432),
  JOLENE_PUBLIC_ARTIFACT_PATH: z
    .string()
    .trim()
    .min(1)
    .default(".jolene/exports/public-career-evidence.json"),
  JOLENE_PUBLIC_ARTIFACT_SOURCE: z.enum(["file", "https"]).default("file"),
  JOLENE_PUBLIC_ARTIFACT_URL: z.preprocess(
    (value) => typeof value === "string" && value.trim() === ""
      ? undefined
      : value,
    z.string().trim().min(1).optional(),
  ),
  JOLENE_PUBLIC_ARTIFACT_ALLOW_LOOPBACK: z.enum(["true", "false"])
    .default("false"),
  JOLENE_PUBLIC_ARTIFACT_TIMEOUT_MS: z.coerce.number().int().min(1_000)
    .max(30_000).default(5_000),
  JOLENE_PUBLIC_EXPECTED_CORPUS_VERSION: z.preprocess(
    (value) => typeof value === "string" && value.trim() === ""
      ? undefined
      : value,
    z.string().regex(/^career:[a-f0-9]{64}$/).optional(),
  ),
  JOLENE_PUBLIC_CONTACT_QUEUE_PATH: z.string().trim().min(1)
    .default(".jolene/public/contact-intents.json"),
  JOLENE_PUBLIC_CONTACT_RETENTION_DAYS: z.coerce.number().int().min(1).max(90)
    .default(30),
  JOLENE_PUBLIC_CONTACT_QUEUE_MAX_ENTRIES: z.coerce.number().int().min(1)
    .max(1_000).default(500),
  JOLENE_PUBLIC_AUDIT_PATH: z.string().trim().min(1)
    .default(".jolene/public/audit.json"),
  JOLENE_PUBLIC_AUDIT_RETENTION_DAYS: z.coerce.number().int().min(1).max(90)
    .default(30),
  JOLENE_PUBLIC_AUDIT_MAX_ENTRIES: z.coerce.number().int().min(1).max(10_000)
    .default(5_000),
  JOLENE_PUBLIC_REQUESTS_PER_MINUTE: z.coerce.number().int().min(1).max(600)
    .default(60),
  JOLENE_PUBLIC_MAX_CONCURRENT_REQUESTS: z.coerce.number().int().min(1).max(64)
    .default(8),
  JOLENE_PUBLIC_AUTH_MODE: z.enum(["disabled", "bearer"]).default("disabled"),
  JOLENE_PUBLIC_API_TOKEN: z.preprocess(
    (value) => typeof value === "string" && value.trim() === ""
      ? undefined
      : value,
    z.string().trim().min(32).optional(),
  ),
  JOLENE_PUBLIC_ANSWER_MODE: z.enum(["deterministic", "openai"])
    .default("deterministic"),
  JOLENE_PUBLIC_OPENAI_MODEL: z.string().trim().min(1).default("gpt-5.4-mini"),
  JOLENE_PUBLIC_OPENAI_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(30_000)
    .default(8_000),
  JOLENE_PUBLIC_OPENAI_BUDGET_PATH: z.string().trim().min(1)
    .default(".jolene/public/model-budget.json"),
  JOLENE_PUBLIC_OPENAI_REQUESTS_PER_DAY: z.coerce.number().int().min(1)
    .max(10_000).default(100),
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
    environment.JOLENE_PUBLIC_HOST === "0.0.0.0" &&
    environment.JOLENE_PUBLIC_CONTAINER_MODE !== "true"
  ) {
    context.addIssue({
      code: "custom",
      path: ["JOLENE_PUBLIC_HOST"],
      message: "0.0.0.0 is allowed only inside the isolated public container.",
    });
  }
  if (
    environment.JOLENE_PUBLIC_OPERATIONS_HOST === "0.0.0.0" &&
    environment.JOLENE_PUBLIC_CONTAINER_MODE !== "true"
  ) {
    context.addIssue({
      code: "custom",
      path: ["JOLENE_PUBLIC_OPERATIONS_HOST"],
      message: "0.0.0.0 is allowed only inside the isolated public container.",
    });
  }
  if (environment.JOLENE_PUBLIC_PORT === environment.JOLENE_PUBLIC_OPERATIONS_PORT) {
    context.addIssue({
      code: "custom",
      path: ["JOLENE_PUBLIC_OPERATIONS_PORT"],
      message: "The public and operations listeners require different ports.",
    });
  }
  if (environment.JOLENE_PUBLIC_ANSWER_MODE === "openai" && !environment.OPENAI_API_KEY) {
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
  if (
    environment.JOLENE_PUBLIC_AUTH_MODE === "bearer" &&
    !environment.JOLENE_PUBLIC_API_TOKEN
  ) {
    context.addIssue({
      code: "custom",
      path: ["JOLENE_PUBLIC_API_TOKEN"],
      message: "JOLENE_PUBLIC_API_TOKEN is required when bearer authentication is enabled.",
    });
  }
  if (
    environment.JOLENE_PUBLIC_ARTIFACT_SOURCE === "https" &&
    (!environment.JOLENE_PUBLIC_ARTIFACT_URL ||
      !environment.JOLENE_PUBLIC_EXPECTED_CORPUS_VERSION)
  ) {
    context.addIssue({
      code: "custom",
      path: ["JOLENE_PUBLIC_ARTIFACT_URL"],
      message: "HTTPS artifact mode requires a URL and expected corpus version.",
    });
  }
});

export interface PublicDelegateConfig {
  readonly enabled: boolean;
  readonly host: string;
  readonly port: number;
  readonly operationsHost: string;
  readonly operationsPort: number;
  readonly artifactPath: string;
  readonly artifactSource: "file" | "https";
  readonly artifactUrl: string | undefined;
  readonly artifactTimeoutMilliseconds: number;
  readonly expectedCorpusVersion: string | undefined;
  readonly contactQueuePath: string;
  readonly contactRetentionDays: number;
  readonly contactQueueMaxEntries: number;
  readonly auditPath: string;
  readonly auditRetentionDays: number;
  readonly auditMaxEntries: number;
  readonly requestsPerMinute: number;
  readonly maxConcurrentRequests: number;
  readonly authMode: "disabled" | "bearer";
  readonly apiToken: string | undefined;
  readonly answerMode: "deterministic" | "openai";
  readonly openaiModel: string;
  readonly openaiTimeoutMilliseconds: number;
  readonly openaiBudgetPath: string;
  readonly openaiRequestsPerDay: number;
  readonly retrievalMode: "deterministic" | "hybrid";
  readonly openaiEmbeddingModel: string;
  readonly openaiApiKey: string | undefined;
}

export function loadPublicDelegateConfig(): PublicDelegateConfig {
  dotenv.config({
    path: path.resolve(process.cwd(), ".env.public.local"),
    quiet: true,
  });
  return parsePublicDelegateConfig(process.env);
}

export function parsePublicDelegateConfig(
  environment: Record<string, string | undefined>,
): PublicDelegateConfig {
  const parsed = publicEnvSchema.parse(environment);
  const artifactUrl = parsed.JOLENE_PUBLIC_ARTIFACT_URL
    ? normalizePublicArtifactUrl(
        parsed.JOLENE_PUBLIC_ARTIFACT_URL,
        parsed.JOLENE_PUBLIC_ARTIFACT_ALLOW_LOOPBACK === "true",
      )
    : undefined;
  return {
    enabled: parsed.JOLENE_PUBLIC_ENABLED === "true",
    host: parsed.JOLENE_PUBLIC_HOST,
    port: parsed.JOLENE_PUBLIC_PORT,
    operationsHost: parsed.JOLENE_PUBLIC_OPERATIONS_HOST,
    operationsPort: parsed.JOLENE_PUBLIC_OPERATIONS_PORT,
    artifactPath: path.resolve(
      process.cwd(),
      parsed.JOLENE_PUBLIC_ARTIFACT_PATH,
    ),
    artifactSource: parsed.JOLENE_PUBLIC_ARTIFACT_SOURCE,
    artifactUrl,
    artifactTimeoutMilliseconds: parsed.JOLENE_PUBLIC_ARTIFACT_TIMEOUT_MS,
    expectedCorpusVersion: parsed.JOLENE_PUBLIC_EXPECTED_CORPUS_VERSION,
    contactQueuePath: path.resolve(
      process.cwd(),
      parsed.JOLENE_PUBLIC_CONTACT_QUEUE_PATH,
    ),
    contactRetentionDays: parsed.JOLENE_PUBLIC_CONTACT_RETENTION_DAYS,
    contactQueueMaxEntries: parsed.JOLENE_PUBLIC_CONTACT_QUEUE_MAX_ENTRIES,
    auditPath: path.resolve(process.cwd(), parsed.JOLENE_PUBLIC_AUDIT_PATH),
    auditRetentionDays: parsed.JOLENE_PUBLIC_AUDIT_RETENTION_DAYS,
    auditMaxEntries: parsed.JOLENE_PUBLIC_AUDIT_MAX_ENTRIES,
    requestsPerMinute: parsed.JOLENE_PUBLIC_REQUESTS_PER_MINUTE,
    maxConcurrentRequests: parsed.JOLENE_PUBLIC_MAX_CONCURRENT_REQUESTS,
    authMode: parsed.JOLENE_PUBLIC_AUTH_MODE,
    apiToken: parsed.JOLENE_PUBLIC_API_TOKEN,
    answerMode: parsed.JOLENE_PUBLIC_ANSWER_MODE,
    openaiModel: parsed.JOLENE_PUBLIC_OPENAI_MODEL,
    openaiTimeoutMilliseconds: parsed.JOLENE_PUBLIC_OPENAI_TIMEOUT_MS,
    openaiBudgetPath: path.resolve(
      process.cwd(),
      parsed.JOLENE_PUBLIC_OPENAI_BUDGET_PATH,
    ),
    openaiRequestsPerDay: parsed.JOLENE_PUBLIC_OPENAI_REQUESTS_PER_DAY,
    retrievalMode: parsed.JOLENE_PUBLIC_RETRIEVAL_MODE,
    openaiEmbeddingModel: parsed.JOLENE_PUBLIC_OPENAI_EMBEDDING_MODEL,
    openaiApiKey: parsed.OPENAI_API_KEY,
  };
}

export function normalizePublicArtifactUrl(
  value: string,
  allowLoopback = false,
): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Public artifact URL must be valid.");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const loopback = allowLoopback && url.protocol === "http:" &&
    (hostname === "127.0.0.1" || hostname === "::1");
  if (
    (!loopback && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.pathname === "/" ||
    url.search ||
    url.hash ||
    (!loopback && isPrivateArtifactHostname(hostname))
  ) {
    throw new Error("Public artifact URL must use a public HTTPS resource without credentials, query, or fragment.");
  }
  return url.href;
}

function isPrivateArtifactHostname(hostname: string): boolean {
  if (hostname === "localhost" || hostname.endsWith(".local")) return true;
  if (isIP(hostname) === 6) return true;
  if (isIP(hostname) !== 4) return false;
  const octets = hostname.split(".").map(Number);
  const first = octets[0] ?? -1;
  const second = octets[1] ?? -1;
  return first === 0 || first === 10 || first === 127 || first >= 224 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19));
}
