import path from "node:path";

import dotenv from "dotenv";
import { z } from "zod";

const publicEnvSchema = z.object({
  JOLENE_PUBLIC_HOST: z
    .enum(["127.0.0.1", "::1", "localhost"])
    .default("127.0.0.1"),
  JOLENE_PUBLIC_PORT: z.coerce.number().int().min(1).max(65_535).default(8431),
  JOLENE_PUBLIC_ARTIFACT_PATH: z
    .string()
    .trim()
    .min(1)
    .default(".jolene/exports/public-career-evidence.json"),
});

export interface PublicDelegateConfig {
  readonly host: string;
  readonly port: number;
  readonly artifactPath: string;
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
    host: parsed.JOLENE_PUBLIC_HOST,
    port: parsed.JOLENE_PUBLIC_PORT,
    artifactPath: path.resolve(
      process.cwd(),
      parsed.JOLENE_PUBLIC_ARTIFACT_PATH,
    ),
  };
}
