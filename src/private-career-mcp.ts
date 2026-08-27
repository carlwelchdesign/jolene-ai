import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { createPrivateCareerMcpApplication } from
  "./mcp/private-career-mcp-application.js";
import { parsePrivateCareerMcpConfig } from
  "./mcp/private-career-mcp-config.js";
import { createPrivateCareerMcpServer } from
  "./mcp/private-career-mcp-server.js";

try {
  const config = parsePrivateCareerMcpConfig(process.env);
  const application = createPrivateCareerMcpApplication(config);
  const handle = serveStdio(
    () => createPrivateCareerMcpServer(application.service),
    {
      onerror: () => {
        process.stderr.write("Private career MCP transport error.\n");
      },
    },
  );
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    application.close();
  };
  const shutdown = async (): Promise<void> => {
    await handle.close().catch(() => undefined);
    close();
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
  process.once("exit", close);
} catch {
  process.stderr.write("Private career MCP startup failed.\n");
  process.exitCode = 1;
}
