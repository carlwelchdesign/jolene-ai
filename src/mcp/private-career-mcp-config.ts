import { statSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

const identitySchema = z.string().trim().min(2).max(120)
  .regex(/^[a-z0-9][a-z0-9._-]*$/i);

const configSchema = z.object({
  databasePath: z.string().trim().min(1),
  actorId: identitySchema,
  workspaceId: identitySchema,
  clientId: identitySchema,
}).strict();

export interface PrivateCareerMcpConfig {
  readonly databasePath: string;
  readonly actorId: string;
  readonly workspaceId: string;
  readonly clientId: string;
}

export function parsePrivateCareerMcpConfig(
  environment: Record<string, string | undefined>,
  workingDirectory = process.cwd(),
): PrivateCareerMcpConfig {
  const parsed = configSchema.parse({
    databasePath: environment.JOLENE_MCP_DATABASE_PATH,
    actorId: environment.JOLENE_MCP_ACTOR_ID,
    workspaceId: environment.JOLENE_MCP_WORKSPACE_ID,
    clientId: environment.JOLENE_MCP_CLIENT_ID,
  });
  if (parsed.databasePath === ":memory:") {
    throw new Error("Private career MCP requires an existing file database.");
  }
  return {
    ...parsed,
    databasePath: path.resolve(workingDirectory, parsed.databasePath),
  };
}

export function assertPrivateCareerMcpDatabase(databasePath: string): void {
  try {
    if (!statSync(databasePath).isFile()) throw new Error("not-file");
  } catch {
    throw new Error("Private career MCP requires an existing Jolene database file.");
  }
}
