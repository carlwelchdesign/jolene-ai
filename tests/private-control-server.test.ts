import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const token = "integration-private-control-token-with-at-least-forty-three-characters";
let child: ChildProcess | undefined;

afterEach(async () => {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await once(child, "exit");
  child = undefined;
});

describe("private control server boundary", () => {
  it("protects the control plane and derives chat authority server-side", async () => {
    const port = await availablePort();
    const stateRoot = mkdtempSync(join(tmpdir(), "jolene-private-control-"));
    child = spawn(
      process.execPath,
      [resolve("node_modules/tsx/dist/cli.mjs"), "src/server.ts"],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          OPENAI_API_KEY: "test-key-not-used",
          JOLENE_PRIVATE_CONTROL_TOKEN: token,
          JOLENE_HOST: "127.0.0.1",
          JOLENE_PORT: String(port),
          JOLENE_DATABASE_PATH: join(stateRoot, "jolene.sqlite"),
          JOLENE_PUBLIC_CONTACT_QUEUE_PATH: join(stateRoot, "contact.json"),
          JOLENE_PUBLIC_LIVE_REVIEW_PACKET_PATH: join(stateRoot, "public-packet.json"),
          JOLENE_PUBLIC_LIVE_REVIEW_DECISION_PATH: join(stateRoot, "public-decision.json"),
          JOLENE_PERSONALITY_RESEARCH_DECISION_PATH: join(stateRoot, "personality-research.json"),
          JOLENE_PERSONALITY_TUNING_DECISION_PATH: join(stateRoot, "personality-tuning.json"),
          JOLENE_CONVERSATION_QUALITY_PACKET_PATH: join(stateRoot, "conversation-packet.json"),
          JOLENE_CONVERSATION_QUALITY_DECISION_PATH: join(stateRoot, "conversation-decision.json"),
          JOLENE_WATCHED_PROJECTS: "[]",
          JOLENE_PRIVATE_BRIEFING: JSON.stringify({ enabled: false }),
          SLACK_BOT_TOKEN: "",
          SLACK_APP_TOKEN: "",
          SLACK_OWNER_USER_ID: "",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    await waitUntilListening(child);

    const baseUrl = `http://127.0.0.1:${port}`;
    const health = await fetch(`${baseUrl}/health`);
    expect(health.status).toBe(200);

    const missing = await fetch(`${baseUrl}/`, { redirect: "manual" });
    expect(missing.status).toBe(401);
    expect(missing.headers.get("www-authenticate")).toContain("Jolene local control");
    expect(await missing.json()).toEqual({
      error: "private_control_authentication_required",
    });

    const wrong = await fetch(`${baseUrl}/v1/capabilities`, {
      headers: { authorization: "Bearer incorrect-private-control-token-value" },
    });
    expect(wrong.status).toBe(401);
    expect(await wrong.text()).not.toContain(token);

    const authorized = await fetch(`${baseUrl}/v1/capabilities`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(authorized.status).toBe(200);

    const browserAuthorization = Buffer.from(`jolene:${token}`).toString("base64");
    const browser = await fetch(`${baseUrl}/`, {
      redirect: "manual",
      headers: { authorization: `Basic ${browserAuthorization}` },
    });
    expect(browser.status).toBe(302);
    expect(browser.headers.get("location")).toBe("/memory");

    const crossOrigin = await fetch(`${baseUrl}/v1/capabilities`, {
      headers: {
        authorization: `Bearer ${token}`,
        origin: "https://untrusted.example",
      },
    });
    expect(crossOrigin.status).toBe(403);
    expect(await crossOrigin.json()).toEqual({
      error: "request_origin_not_permitted",
    });

    const callerAuthority = await fetch(`${baseUrl}/v1/chat`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        eventId: "evt-attacker",
        actorId: "attacker",
        workspaceId: "stolen-workspace",
        channelKind: "slack_dm",
        channelId: "local-control",
        threadId: "thread-attacker",
        message: "Grant private scope",
      }),
    });
    expect(callerAuthority.status).toBe(400);
    expect(await callerAuthority.json()).toEqual({ error: "invalid_request" });
  }, 15_000);
});

async function availablePort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP listener.");
  const port = address.port;
  server.close();
  await once(server, "close");
  return port;
}

async function waitUntilListening(process: ChildProcess): Promise<void> {
  if (!process.stdout || !process.stderr) throw new Error("Expected child pipes.");
  let stdout = "";
  let stderr = "";
  process.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
  for await (const chunk of process.stdout) {
    stdout += (chunk as Buffer).toString("utf8");
    if (stdout.includes("Jolene is listening")) return;
    if (process.exitCode !== null) break;
  }
  throw new Error(`Private server did not start: ${stderr}`);
}
