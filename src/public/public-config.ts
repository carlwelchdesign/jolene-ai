import path from "node:path";

import dotenv from "dotenv";
import { z } from "zod";

const publicEnvSchema = z.object({
  JOLENE_PUBLIC_ENABLED: z.enum(["true", "false"]).default("true"),
  JOLENE_PUBLIC_HOST: z
    .enum(["127.0.0.1", "::1", "localhost"])
    .default("127.0.0.1"),
  JOLENE_PUBLIC_PORT: z.coerce.number().int().min(1).max(65_535).default(8431),
  JOLENE_PUBLIC_ARTIFACT_PATH: z
    .string()
    .trim()
    .min(1)
    .default(".jolene/exports/public-career-evidence.json"),
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
  JOLENE_PUBLIC_ANSWER_MODE: z.enum(["deterministic", "openai"])
    .default("deterministic"),
  JOLENE_PUBLIC_OPENAI_MODEL: z.string().trim().min(1).default("gpt-5.6-terra"),
  JOLENE_PUBLIC_OPENAI_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(30_000)
    .default(8_000),
  OPENAI_API_KEY: z.preprocess(
    (value) => typeof value === "string" && value.trim() === ""
      ? undefined
      : value,
    z.string().trim().min(1).optional(),
  ),
}).superRefine((environment, context) => {
  if (environment.JOLENE_PUBLIC_ANSWER_MODE === "openai" && !environment.OPENAI_API_KEY) {
    context.addIssue({
      code: "custom",
      path: ["OPENAI_API_KEY"],
      message: "OPENAI_API_KEY is required when public answer mode is openai.",
    });
  }
});

export interface PublicDelegateConfig {
  readonly enabled: boolean;
  readonly host: string;
  readonly port: number;
  readonly artifactPath: string;
  readonly contactQueuePath: string;
  readonly contactRetentionDays: number;
  readonly contactQueueMaxEntries: number;
  readonly auditPath: string;
  readonly auditRetentionDays: number;
  readonly auditMaxEntries: number;
  readonly requestsPerMinute: number;
  readonly maxConcurrentRequests: number;
  readonly answerMode: "deterministic" | "openai";
  readonly openaiModel: string;
  readonly openaiTimeoutMilliseconds: number;
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
  return {
    enabled: parsed.JOLENE_PUBLIC_ENABLED === "true",
    host: parsed.JOLENE_PUBLIC_HOST,
    port: parsed.JOLENE_PUBLIC_PORT,
    artifactPath: path.resolve(
      process.cwd(),
      parsed.JOLENE_PUBLIC_ARTIFACT_PATH,
    ),
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
    answerMode: parsed.JOLENE_PUBLIC_ANSWER_MODE,
    openaiModel: parsed.JOLENE_PUBLIC_OPENAI_MODEL,
    openaiTimeoutMilliseconds: parsed.JOLENE_PUBLIC_OPENAI_TIMEOUT_MS,
    openaiApiKey: parsed.OPENAI_API_KEY,
  };
}
