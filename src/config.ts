import { readFileSync } from "node:fs";
import path from "node:path";

import dotenv from "dotenv";
import { z } from "zod";

import type { WatchedProjectDefinition } from "./domain/watched-project.js";

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
  JOLENE_OBSIDIAN_VAULT_ROOT: z.string().trim().optional(),
  JOLENE_OBSIDIAN_ALLOWLIST: z.string().default(""),
  JOLENE_CAREER_OBSIDIAN_ALLOWLIST: z.string().default(""),
  JOLENE_MAX_HISTORY_TURNS: z.coerce.number().int().min(2).max(100).default(16),
  JOLENE_MAX_MEMORY_ITEMS: z.coerce.number().int().min(1).max(100).default(24),
  JOLENE_WATCHED_PROJECTS: z.string().optional(),
  SLACK_BOT_TOKEN: z.string().trim().optional(),
  SLACK_APP_TOKEN: z.string().trim().optional(),
  SLACK_OWNER_USER_ID: z.string().trim().optional(),
});

export interface AppConfig {
  readonly model: string;
  readonly host: string;
  readonly port: number;
  readonly databasePath: string;
  readonly vaultRoot: string | undefined;
  readonly vaultAllowlist: readonly string[];
  readonly careerVaultAllowlist: readonly string[];
  readonly maxHistoryTurns: number;
  readonly maxMemoryItems: number;
  readonly watchedProjects: readonly WatchedProjectDefinition[];
  readonly slackBotToken: string | undefined;
  readonly slackAppToken: string | undefined;
  readonly slackOwnerUserId: string | undefined;
}

export function loadConfig(): AppConfig {
  dotenv.config({
    path: path.resolve(process.cwd(), ".env.local"),
    quiet: true,
  });

  const env = envSchema.parse(process.env);

  return {
    model: env.JOLENE_MODEL,
    host: env.JOLENE_HOST,
    port: env.JOLENE_PORT,
    databasePath: path.resolve(process.cwd(), env.JOLENE_DATABASE_PATH),
    vaultRoot: emptyToUndefined(env.JOLENE_OBSIDIAN_VAULT_ROOT),
    vaultAllowlist: env.JOLENE_OBSIDIAN_ALLOWLIST.split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    careerVaultAllowlist: env.JOLENE_CAREER_OBSIDIAN_ALLOWLIST.split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    maxHistoryTurns: env.JOLENE_MAX_HISTORY_TURNS,
    maxMemoryItems: env.JOLENE_MAX_MEMORY_ITEMS,
    watchedProjects: loadWatchedProjects(env.JOLENE_WATCHED_PROJECTS),
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

function loadWatchedProjects(
  serialized: string | undefined,
): readonly WatchedProjectDefinition[] {
  if (serialized !== undefined) return parseWatchedProjects(serialized);

  try {
    return parseWatchedProjects(
      readFileSync(
        path.resolve(process.cwd(), ".jolene/watched-projects.json"),
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
