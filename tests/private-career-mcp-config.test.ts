import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertPrivateCareerMcpDatabase,
  parsePrivateCareerMcpConfig,
} from "../src/mcp/private-career-mcp-config.js";

describe("private career MCP config", () => {
  it("requires an explicit actor, workspace, client, and file database", () => {
    const root = mkdtempSync(path.join(tmpdir(), "jolene-mcp-config-"));
    const databasePath = path.join(root, "jolene.sqlite");
    writeFileSync(databasePath, "fixture");
    const config = parsePrivateCareerMcpConfig({
      JOLENE_MCP_DATABASE_PATH: "jolene.sqlite",
      JOLENE_MCP_ACTOR_ID: "carl",
      JOLENE_MCP_WORKSPACE_ID: "professional",
      JOLENE_MCP_CLIENT_ID: "codex-local",
      OPENAI_API_KEY: "not-read-by-this-config",
    }, root);

    expect(config).toEqual({
      databasePath,
      actorId: "carl",
      workspaceId: "professional",
      clientId: "codex-local",
    });
    expect(() => assertPrivateCareerMcpDatabase(databasePath)).not.toThrow();
  });

  it("fails closed for missing scope, in-memory state, or missing files", () => {
    expect(() => parsePrivateCareerMcpConfig({
      JOLENE_MCP_DATABASE_PATH: "db.sqlite",
    })).toThrow();
    expect(() => parsePrivateCareerMcpConfig({
      JOLENE_MCP_DATABASE_PATH: ":memory:",
      JOLENE_MCP_ACTOR_ID: "carl",
      JOLENE_MCP_WORKSPACE_ID: "professional",
      JOLENE_MCP_CLIENT_ID: "codex-local",
    })).toThrow(/existing file database/i);
    expect(() => assertPrivateCareerMcpDatabase("/definitely/missing/jolene.sqlite"))
      .toThrow(/existing Jolene database file/i);
  });
});
