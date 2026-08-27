import path from "node:path";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { describe, expect, it } from "vitest";

import {
  mcpScope,
  seedPrivateCareerMcpDatabase,
} from "./helpers/private-career-mcp-fixture.js";

describe("private career MCP stdio boundary", () => {
  it("advertises only three read-only tools and returns structured approved evidence", async () => {
    const fixture = seedPrivateCareerMcpDatabase();
    const client = new Client({ name: "jolene-test-client", version: "1.0.0" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        path.resolve("node_modules/tsx/dist/cli.mjs"),
        path.resolve("src/private-career-mcp.ts"),
      ],
      cwd: process.cwd(),
      env: {
        JOLENE_MCP_DATABASE_PATH: fixture.databasePath,
        JOLENE_MCP_ACTOR_ID: mcpScope.actorId,
        JOLENE_MCP_WORKSPACE_ID: mcpScope.workspaceId,
        JOLENE_MCP_CLIENT_ID: "stdio-test",
      },
      stderr: "pipe",
    });
    try {
      await client.connect(transport);
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name)).toEqual([
        "career_search",
        "career_inspect",
        "career_compare_job",
      ]);
      for (const tool of listed.tools) {
        expect(tool.annotations).toMatchObject({
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        });
      }

      const result = await client.callTool({
        name: "career_search",
        arguments: { query: "TypeScript React", limit: 3 },
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        schemaVersion: "1.0.0",
        results: [{ claimId: fixture.internalClaimId }],
      });
    } finally {
      await client.close();
    }
  }, 15_000);
});
