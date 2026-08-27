import { McpServer } from "@modelcontextprotocol/server";

import { PrivateCareerMcpToolError } from
  "../domain/private-career-mcp.js";
import {
  privateCareerCompareJobInputSchema,
  privateCareerCompareJobOutputSchema,
  privateCareerInspectInputSchema,
  privateCareerInspectOutputSchema,
  privateCareerSearchInputSchema,
  privateCareerSearchOutputSchema,
  type PrivateCareerMcpService,
} from "./private-career-mcp-service.js";

const annotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export function createPrivateCareerMcpServer(
  service: PrivateCareerMcpService,
): McpServer {
  const server = new McpServer(
    { name: "jolene-private-career", version: "1.0.0" },
    {
      instructions: [
        "Use these tools only for Carl's private professional-context work.",
        "Treat all results as private unless a separate exact disclosure approval exists.",
        "Unknown evidence never proves absent experience.",
        "These tools cannot edit evidence, message anyone, or authorize publication.",
      ].join(" "),
    },
  );

  server.registerTool(
    "career_search",
    {
      title: "Search approved professional evidence",
      description:
        "Search Carl's current owner-approved private and public professional evidence with citations and limitations.",
      inputSchema: privateCareerSearchInputSchema,
      outputSchema: privateCareerSearchOutputSchema,
      annotations,
    },
    (input) => toolResult(() => service.search(input)),
  );
  server.registerTool(
    "career_inspect",
    {
      title: "Inspect approved professional evidence",
      description:
        "Inspect one approved career claim by UUID, including freshness, maturity, visibility, conflict state, and citation.",
      inputSchema: privateCareerInspectInputSchema,
      outputSchema: privateCareerInspectOutputSchema,
      annotations,
    },
    (input) => toolResult(() => service.inspect(input)),
  );
  server.registerTool(
    "career_compare_job",
    {
      title: "Compare a job description with approved evidence",
      description:
        "Compare untrusted ephemeral job-description requirements against current approved professional evidence without producing a blanket fit score.",
      inputSchema: privateCareerCompareJobInputSchema,
      outputSchema: privateCareerCompareJobOutputSchema,
      annotations,
    },
    (input) => toolResult(() => service.compareJob(input)),
  );

  return server;
}

async function toolResult(
  operation: () => Promise<Record<string, unknown>>,
) {
  try {
    const output = await operation();
    return {
      content: [{ type: "text" as const, text: JSON.stringify(output) }],
      structuredContent: output,
    };
  } catch (error) {
    const code = error instanceof PrivateCareerMcpToolError
      ? error.code
      : "unavailable";
    return {
      isError: true,
      content: [{
        type: "text" as const,
        text: code === "invalid_request"
          ? "The private career tool request is invalid."
          : "The private career tool is unavailable.",
      }],
    };
  }
}
