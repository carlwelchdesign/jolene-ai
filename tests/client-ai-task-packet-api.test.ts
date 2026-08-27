import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const server = readFileSync(resolve(projectRoot, "src/server.ts"), "utf8");
const application = readFileSync(resolve(projectRoot, "src/app.ts"), "utf8");

describe("owner-local client-AI packet API", () => {
  it("wires the durable packet service into application shutdown", () => {
    expect(application).toContain("readonly clientAiPackets: ClientAiTaskPacketService");
    expect(application).toContain("new SqliteClientAiTaskPacketStore(config.databasePath)");
    expect(application).toContain("clientAiPackets.close()");
  });

  it("same-origin protects every packet mutation", () => {
    for (const route of [
      'url.pathname === "/v1/client-ai-packets"',
      "clientAiPacketActionMatch?.[1]",
      "clientAiHandoffReviewMatch?.[1]",
    ]) {
      const start = server.indexOf(route);
      expect(start).toBeGreaterThan(-1);
      expect(server.slice(start, start + 650)).toContain("assertSameOrigin(request.headers)");
    }
  });

  it("does not expose transcript execution over HTTP", () => {
    expect(server).not.toMatch(/client-ai-packets.*\/(turns|transcript)/);
    expect(server).not.toContain("clientAiPackets.recordTurn(");
  });
});
