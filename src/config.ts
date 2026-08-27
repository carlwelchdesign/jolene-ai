import { readFileSync } from "node:fs";
import path from "node:path";

import dotenv from "dotenv";
import { z } from "zod";

import { resolveSecretValue } from "./config-secret-files.js";
import type { WatchedProjectDefinition } from "./domain/watched-project.js";
import type { PrivateBriefingPolicy } from "./domain/private-briefing.js";

const envSchema = z.object({
  OPENAI_API_KEY: z.string().trim().min(1),
  JOLENE_MODEL: z.string().trim().min(1).default("gpt-5.6-terra"),
  JOLENE_HOST: z.string().trim().min(1).default("127.0.0.1"),
  JOLENE_PORT: z.coerce.number().int().min(1).max(65_535).default(8421),
  JOLENE_DATABASE_PATH: z
    .string()
    .trim()
    .min(1)
    .default(".jolene/jolene.sqlite"),
  JOLENE_PUBLIC_CONTACT_QUEUE_PATH: z.string().trim().min(1)
    .default(".jolene/public/contact-intents.json"),
  JOLENE_PUBLIC_CONTACT_RETENTION_DAYS: z.coerce.number().int().min(1).max(90)
    .default(30),
  JOLENE_PUBLIC_CONTACT_QUEUE_MAX_ENTRIES: z.coerce.number().int().min(1)
    .max(1_000).default(500),
  JOLENE_PUBLIC_LIVE_REVIEW_PACKET_PATH: z.string().trim().min(1)
    .default(".jolene/evaluations/public-live-model-review.json"),
  JOLENE_PUBLIC_LIVE_REVIEW_DECISION_PATH: z.string().trim().min(1)
    .default(".jolene/evaluations/public-live-model-decision.json"),
  JOLENE_PERSONALITY_RESEARCH_DECISION_PATH: z.string().trim().min(1)
    .default(".jolene/personality/research-decision.json"),
  JOLENE_OBSIDIAN_VAULT_ROOT: z.string().trim().optional(),
  JOLENE_OBSIDIAN_ALLOWLIST: z.string().default(""),
  JOLENE_CAREER_OBSIDIAN_ALLOWLIST: z.string().default(""),
  JOLENE_OWNER_ACTOR_ID: z.string().trim().min(1).default("carl"),
  JOLENE_OWNER_WORKSPACE_ID: z.string().trim().min(1).default("personal"),
  JOLENE_CAREER_WORKSPACE_ID: z.string().trim().min(1).default("professional"),
  JOLENE_CAREER_EMBEDDINGS_ENABLED: z.enum(["true", "false"]).default("false"),
  OPENAI_EMBEDDING_MODEL: z.string().trim().min(1).default("text-embedding-3-small"),
  JOLENE_MAX_HISTORY_TURNS: z.coerce.number().int().min(2).max(100).default(16),
  JOLENE_MAX_MEMORY_ITEMS: z.coerce.number().int().min(1).max(100).default(24),
  JOLENE_WATCHED_PROJECTS: z.string().optional(),
  JOLENE_PRIVATE_BRIEFING: z.string().optional(),
  SLACK_BOT_TOKEN: z.string().trim().optional(),
  SLACK_APP_TOKEN: z.string().trim().optional(),
  SLACK_OWNER_USER_ID: z.string().trim().regex(/^[UW][A-Z0-9]+$/)
    .or(z.literal(""))
    .optional(),
});

export interface AppConfig {
  readonly model: string;
  readonly host: string;
  readonly port: number;
  readonly databasePath: string;
  readonly contactQueuePath: string;
  readonly contactRetentionDays: number;
  readonly contactQueueMaxEntries: number;
  readonly publicLiveReviewPacketPath: string;
  readonly publicLiveReviewDecisionPath: string;
  readonly personalityResearchDecisionPath: string;
  readonly vaultRoot: string | undefined;
  readonly vaultAllowlist: readonly string[];
  readonly careerVaultAllowlist: readonly string[];
  readonly ownerActorId: string;
  readonly ownerWorkspaceId: string;
  readonly careerOwnerActorId: string;
  readonly careerWorkspaceId: string;
  readonly careerEmbeddingsEnabled: boolean;
  readonly embeddingModel: string;
  readonly maxHistoryTurns: number;
  readonly maxMemoryItems: number;
  readonly watchedProjects: readonly WatchedProjectDefinition[];
  readonly privateBriefing: PrivateBriefingPolicy;
  readonly slackBotToken: string | undefined;
  readonly slackAppToken: string | undefined;
  readonly slackOwnerUserId: string | undefined;
}

export function loadConfig(): AppConfig {
  dotenv.config({
    path: path.resolve(process.cwd(), ".env.local"),
    quiet: true,
  });

  return parseConfig(process.env);
}

export function parseConfig(
  environment: Record<string, string | undefined>,
  workingDirectory = process.cwd(),
): AppConfig {
  const env = envSchema.parse({
    ...environment,
    OPENAI_API_KEY: resolveSecretValue(
      environment,
      "OPENAI_API_KEY",
      "OPENAI_API_KEY_FILE",
      { required: true, workingDirectory },
    ),
    SLACK_BOT_TOKEN: resolveSecretValue(
      environment,
      "SLACK_BOT_TOKEN",
      "SLACK_BOT_TOKEN_FILE",
      { required: false, workingDirectory },
    ),
    SLACK_APP_TOKEN: resolveSecretValue(
      environment,
      "SLACK_APP_TOKEN",
      "SLACK_APP_TOKEN_FILE",
      { required: false, workingDirectory },
    ),
  });

  return {
    model: env.JOLENE_MODEL,
    host: env.JOLENE_HOST,
    port: env.JOLENE_PORT,
    databasePath: path.resolve(workingDirectory, env.JOLENE_DATABASE_PATH),
    contactQueuePath: path.resolve(
      workingDirectory,
      env.JOLENE_PUBLIC_CONTACT_QUEUE_PATH,
    ),
    contactRetentionDays: env.JOLENE_PUBLIC_CONTACT_RETENTION_DAYS,
    contactQueueMaxEntries: env.JOLENE_PUBLIC_CONTACT_QUEUE_MAX_ENTRIES,
    publicLiveReviewPacketPath: path.resolve(
      workingDirectory,
      env.JOLENE_PUBLIC_LIVE_REVIEW_PACKET_PATH,
    ),
    publicLiveReviewDecisionPath: path.resolve(
      workingDirectory,
      env.JOLENE_PUBLIC_LIVE_REVIEW_DECISION_PATH,
    ),
    personalityResearchDecisionPath: path.resolve(
      workingDirectory,
      env.JOLENE_PERSONALITY_RESEARCH_DECISION_PATH,
    ),
    vaultRoot: emptyToUndefined(env.JOLENE_OBSIDIAN_VAULT_ROOT),
    vaultAllowlist: env.JOLENE_OBSIDIAN_ALLOWLIST.split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    careerVaultAllowlist: env.JOLENE_CAREER_OBSIDIAN_ALLOWLIST.split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    ownerActorId: env.JOLENE_OWNER_ACTOR_ID,
    ownerWorkspaceId: env.JOLENE_OWNER_WORKSPACE_ID,
    careerOwnerActorId: env.JOLENE_OWNER_ACTOR_ID,
    careerWorkspaceId: env.JOLENE_CAREER_WORKSPACE_ID,
    careerEmbeddingsEnabled: env.JOLENE_CAREER_EMBEDDINGS_ENABLED === "true",
    embeddingModel: env.OPENAI_EMBEDDING_MODEL,
    maxHistoryTurns: env.JOLENE_MAX_HISTORY_TURNS,
    maxMemoryItems: env.JOLENE_MAX_MEMORY_ITEMS,
    watchedProjects: loadWatchedProjects(
      env.JOLENE_WATCHED_PROJECTS,
      workingDirectory,
    ),
    privateBriefing: loadPrivateBriefing(
      env.JOLENE_PRIVATE_BRIEFING,
      workingDirectory,
    ),
    slackBotToken: emptyToUndefined(env.SLACK_BOT_TOKEN),
    slackAppToken: emptyToUndefined(env.SLACK_APP_TOKEN),
    slackOwnerUserId: emptyToUndefined(env.SLACK_OWNER_USER_ID),
  };
}

const watchedProjectConfigSchema = z.array(
  z.object({
    id: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    label: z.string().trim().min(1).max(120),
    rootPath: z.string().trim().min(1),
    planFile: z.string().trim().min(1).nullable().default(null),
    reviewWindowDays: z.number().int().min(1).max(365).default(30),
    monitoring: z.object({
      enabled: z.boolean().default(false),
      cadenceMinutes: z.number().int().min(5).max(1_440).default(60),
      maxRunsPerDay: z.number().int().min(1).max(288).default(24),
      stopAfterRuns: z.number().int().min(1).max(100_000).default(720),
      historyLimit: z.number().int().min(1).max(500).default(100),
      notifications: z.object({
        enabled: z.boolean().default(false),
        destination: z.literal("slack_owner_dm").default("slack_owner_dm"),
        maxAttempts: z.number().int().min(1).max(10).default(5),
      }).default({
        enabled: false,
        destination: "slack_owner_dm",
        maxAttempts: 5,
      }),
    }).default({
      enabled: false,
      cadenceMinutes: 60,
      maxRunsPerDay: 24,
      stopAfterRuns: 720,
      historyLimit: 100,
      notifications: {
        enabled: false,
        destination: "slack_owner_dm",
        maxAttempts: 5,
      },
    }),
  }),
).superRefine((projects, context) => {
  const ids = new Set<string>();
  projects.forEach((project, index) => {
    if (ids.has(project.id)) {
      context.addIssue({
        code: "custom",
        path: [index, "id"],
        message: "Watched project IDs must be unique.",
      });
    }
    ids.add(project.id);

    if (project.planFile) {
      const resolvedRoot = path.resolve(project.rootPath);
      const resolvedPlan = path.resolve(resolvedRoot, project.planFile);
      const relativePlan = path.relative(resolvedRoot, resolvedPlan);
      if (relativePlan.startsWith("..") || path.isAbsolute(relativePlan)) {
        context.addIssue({
          code: "custom",
          path: [index, "planFile"],
          message: "The plan file must stay inside the watched project root.",
        });
      }
    }
  });
});

const privateBriefingSchema = z.object({
  enabled: z.boolean().default(false),
  destination: z.literal("slack_owner_dm").default("slack_owner_dm"),
  frequency: z.enum(["daily", "weekly"]).default("daily"),
  dayOfWeek: z.number().int().min(0).max(6).nullable().default(null),
  localHour: z.number().int().min(0).max(23).default(8),
  localMinute: z.number().int().min(0).max(59).default(0),
  timeZone: z.string().trim().min(1).default("America/Los_Angeles"),
  maxDeliveriesPerDay: z.number().int().min(1).max(4).default(1),
  stopAfterDeliveries: z.number().int().min(1).max(10_000).default(365),
  historyLimit: z.number().int().min(1).max(500).default(90),
  maxAttempts: z.number().int().min(1).max(10).default(5),
}).superRefine((policy, context) => {
  if (policy.frequency === "weekly" && policy.dayOfWeek === null) {
    context.addIssue({
      code: "custom",
      path: ["dayOfWeek"],
      message: "Weekly briefings require a day of week.",
    });
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: policy.timeZone }).format();
  } catch {
    context.addIssue({
      code: "custom",
      path: ["timeZone"],
      message: "Private briefing timeZone must be a valid IANA zone.",
    });
  }
});

export function parseWatchedProjects(
  serialized: string,
): readonly WatchedProjectDefinition[] {
  let raw: unknown;
  try {
    raw = JSON.parse(serialized);
  } catch {
    throw new Error("Watched project configuration must be valid JSON.");
  }

  return watchedProjectConfigSchema.parse(raw).map((project) => ({
    ...project,
    rootPath: path.resolve(project.rootPath),
    planFile: project.planFile
      ? path.normalize(project.planFile)
      : null,
  }));
}

export function parsePrivateBriefing(serialized: string): PrivateBriefingPolicy {
  let raw: unknown;
  try {
    raw = JSON.parse(serialized);
  } catch {
    throw new Error("Private briefing configuration must be valid JSON.");
  }
  return privateBriefingSchema.parse(raw);
}

function loadPrivateBriefing(
  serialized: string | undefined,
  workingDirectory: string,
): PrivateBriefingPolicy {
  if (serialized !== undefined) return parsePrivateBriefing(serialized);
  try {
    return parsePrivateBriefing(readFileSync(
      path.resolve(workingDirectory, ".jolene/private-briefing.json"),
      "utf8",
    ));
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return privateBriefingSchema.parse({});
    }
    throw error;
  }
}

function loadWatchedProjects(
  serialized: string | undefined,
  workingDirectory: string,
): readonly WatchedProjectDefinition[] {
  if (serialized !== undefined) return parseWatchedProjects(serialized);

  try {
    return parseWatchedProjects(
      readFileSync(
        path.resolve(workingDirectory, ".jolene/watched-projects.json"),
        "utf8",
      ),
    );
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return [];
    }
    throw error;
  }
}

function emptyToUndefined(value: string | undefined): string | undefined {
  return value && value.length > 0 ? value : undefined;
}
