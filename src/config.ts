import path from "node:path";

import dotenv from "dotenv";
import { z } from "zod";

const envSchema = z.object({
  OPENAI_API_KEY: z.string().trim().min(1),
  JOLENE_MODEL: z.string().trim().min(1).default("gpt-5.6-terra"),
  JOLENE_PORT: z.coerce.number().int().min(1).max(65_535).default(8421),
  JOLENE_DATABASE_PATH: z
    .string()
    .trim()
    .min(1)
    .default(".jolene/jolene.sqlite"),
  JOLENE_OBSIDIAN_VAULT_ROOT: z.string().trim().optional(),
  JOLENE_OBSIDIAN_ALLOWLIST: z.string().default(""),
  JOLENE_MAX_HISTORY_TURNS: z.coerce.number().int().min(2).max(100).default(16),
  SLACK_BOT_TOKEN: z.string().trim().optional(),
  SLACK_APP_TOKEN: z.string().trim().optional(),
  SLACK_OWNER_USER_ID: z.string().trim().optional(),
});

export interface AppConfig {
  readonly model: string;
  readonly port: number;
  readonly databasePath: string;
  readonly vaultRoot: string | undefined;
  readonly vaultAllowlist: readonly string[];
  readonly maxHistoryTurns: number;
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
    port: env.JOLENE_PORT,
    databasePath: path.resolve(process.cwd(), env.JOLENE_DATABASE_PATH),
    vaultRoot: emptyToUndefined(env.JOLENE_OBSIDIAN_VAULT_ROOT),
    vaultAllowlist: env.JOLENE_OBSIDIAN_ALLOWLIST.split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    maxHistoryTurns: env.JOLENE_MAX_HISTORY_TURNS,
    slackBotToken: emptyToUndefined(env.SLACK_BOT_TOKEN),
    slackAppToken: emptyToUndefined(env.SLACK_APP_TOKEN),
    slackOwnerUserId: emptyToUndefined(env.SLACK_OWNER_USER_ID),
  };
}

function emptyToUndefined(value: string | undefined): string | undefined {
  return value && value.length > 0 ? value : undefined;
}
