import { once } from "node:events";
import { createServer, type Server } from "node:http";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createRedisHostedCoordination,
  createVercelPublicDelegateHandler,
} from "../src/public/vercel-public-delegate.js";
import { FixedWindowPublicRequestAdmission } from "../src/public/public-request-admission.js";
import { InMemoryPublicModelRequestBudget } from "../src/public/public-model-request-budget.js";
import { InMemoryPublicOperationalTelemetry } from "../src/public/public-operational-telemetry.js";
import { createPublicEvidenceArtifact } from "./helpers/public-evidence-fixture.js";

const openServers: Server[] = [];
const nativeFetch = globalThis.fetch.bind(globalThis);

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(openServers.splice(0).map((server) => close(server)));
});

describe("Vercel public delegate adapter", () => {
  it("fails closed unless HTTPS evidence and bearer authentication are configured", () => {
    expect(() => createVercelPublicDelegateHandler({
      JOLENE_PUBLIC_ENABLED: "true",
      JOLENE_PUBLIC_AUTH_MODE: "disabled",
    })).toThrow();
  });

  it("fails closed when OpenAI mode has no API key", () => {
    const artifact = createPublicEvidenceArtifact();
    expect(() => createVercelPublicDelegateHandler({
      JOLENE_PUBLIC_ENABLED: "true",
      JOLENE_PUBLIC_AUTH_MODE: "bearer",
      JOLENE_PUBLIC_API_TOKEN:
        "test-token-with-at-least-thirty-two-characters",
      JOLENE_PUBLIC_ARTIFACT_URL:
        "https://example.test/public-career-evidence.json",
      JOLENE_PUBLIC_EXPECTED_CORPUS_VERSION: artifact.manifest.corpusVersion,
      JOLENE_PUBLIC_ANSWER_MODE: "openai",
    })).toThrow();
  });

  it("fails closed when hybrid retrieval is configured without OpenAI", () => {
    const artifact = createPublicEvidenceArtifact();
    expect(() => createVercelPublicDelegateHandler({
      JOLENE_PUBLIC_ENABLED: "true",
      JOLENE_PUBLIC_AUTH_MODE: "bearer",
      JOLENE_PUBLIC_API_TOKEN:
        "test-token-with-at-least-thirty-two-characters",
      JOLENE_PUBLIC_ARTIFACT_URL:
        "https://example.test/public-career-evidence.json",
      JOLENE_PUBLIC_EXPECTED_CORPUS_VERSION: artifact.manifest.corpusVersion,
      JOLENE_PUBLIC_RETRIEVAL_MODE: "hybrid",
    })).toThrow();
  });

  it("serves the root API contract through Vercel's /api function prefix", async () => {
    const artifact = createPublicEvidenceArtifact();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify(artifact),
      { headers: { "content-type": "application/json" } },
    )));
    const token = "test-token-with-at-least-thirty-two-characters";
    const handler = createVercelPublicDelegateHandler({
      JOLENE_PUBLIC_ENABLED: "true",
      JOLENE_PUBLIC_AUTH_MODE: "bearer",
      JOLENE_PUBLIC_API_TOKEN: token,
      JOLENE_PUBLIC_ARTIFACT_URL: "https://example.test/public-career-evidence.json",
      JOLENE_PUBLIC_EXPECTED_CORPUS_VERSION: artifact.manifest.corpusVersion,
    }, sharedCoordination());
    const server = createServer(handler);
    openServers.push(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing port.");
    const origin = `http://127.0.0.1:${address.port}`;

    const health = await nativeFetch(`${origin}/api/health`);
    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toMatchObject({
      status: "ok",
      corpusVersion: artifact.manifest.corpusVersion,
    });

    const unauthorized = await nativeFetch(`${origin}/api/v1/public-evidence/manifest`);
    expect(unauthorized.status).toBe(401);

    const manifest = await nativeFetch(
      `${origin}/api/v1/public-evidence/manifest`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    expect(manifest.status).toBe(200);
    await expect(manifest.json()).resolves.toEqual(artifact.manifest);

    const contact = await nativeFetch(`${origin}/api/v1/portfolio/contact-intent`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "Recruiter",
        email: "recruiter@example.com",
        message: "Please contact me about a role.",
        consent: true,
      }),
    });
    expect(contact.status).toBe(503);
  });

  it("fails closed when shared hosted coordination is not injected", async () => {
    const artifact = createPublicEvidenceArtifact();
    const handler = createVercelPublicDelegateHandler({
      JOLENE_PUBLIC_ENABLED: "true",
      JOLENE_PUBLIC_AUTH_MODE: "bearer",
      JOLENE_PUBLIC_API_TOKEN: "test-token-with-at-least-thirty-two-characters",
      JOLENE_PUBLIC_ARTIFACT_URL: "https://example.test/public-career-evidence.json",
      JOLENE_PUBLIC_EXPECTED_CORPUS_VERSION: artifact.manifest.corpusVersion,
    });
    const server = createServer(handler);
    openServers.push(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing port.");

    const health = await nativeFetch(`http://127.0.0.1:${address.port}/api/health`);
    expect(health.status).toBe(503);
    await expect(health.json()).resolves.toMatchObject({
      code: "unavailable",
    });
  });

  it("constructs shared coordination only from complete exact server configuration", () => {
    const artifact = createPublicEvidenceArtifact();
    const base = {
      JOLENE_PUBLIC_ENABLED: "true",
      JOLENE_PUBLIC_AUTH_MODE: "bearer",
      JOLENE_PUBLIC_API_TOKEN: "test-token-with-at-least-thirty-two-characters",
      JOLENE_PUBLIC_ARTIFACT_URL: "https://example.test/public-career-evidence.json",
      JOLENE_PUBLIC_EXPECTED_CORPUS_VERSION: artifact.manifest.corpusVersion,
    };
    expect(createRedisHostedCoordination(base)).toBeUndefined();
    expect(createRedisHostedCoordination({
      ...base,
      ...coordinationEnvironment(),
      JOLENE_PUBLIC_COORDINATION_URL: "https://different.example.test",
    })).toBeUndefined();
    expect(createRedisHostedCoordination({
      ...base,
      ...coordinationEnvironment(),
    }, undefined, vi.fn<typeof globalThis.fetch>())).toMatchObject({
      scope: "shared",
    });
  });

  it("preflights and serves through environment-wired shared coordination", async () => {
    const artifact = createPublicEvidenceArtifact();
    const coordinationCommands: unknown[][] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "https://example.test/public-career-evidence.json") {
        return new Response(JSON.stringify(artifact), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.startsWith("https://coordination.example.test")) {
        const body = JSON.parse(String(init?.body));
        if (Array.isArray(body[0])) {
          return new Response(JSON.stringify([
            { result: "PONG" },
            { result: body[1][1] },
          ]));
        }
        coordinationCommands.push(body);
        const script = String(body[1]);
        const result = script.includes("local value = redis.call('GET'")
          ? body.at(-1)
          : script.includes("ZCARD")
          ? [1, body.at(-2)]
          : 1;
        return new Response(JSON.stringify({ result }));
      }
      throw new Error("Unexpected fetch target.");
    }));
    const handler = createVercelPublicDelegateHandler({
      JOLENE_PUBLIC_ENABLED: "true",
      JOLENE_PUBLIC_AUTH_MODE: "bearer",
      JOLENE_PUBLIC_API_TOKEN: "test-token-with-at-least-thirty-two-characters",
      JOLENE_PUBLIC_ARTIFACT_URL: "https://example.test/public-career-evidence.json",
      JOLENE_PUBLIC_EXPECTED_CORPUS_VERSION: artifact.manifest.corpusVersion,
      ...coordinationEnvironment(),
    });
    const server = createServer(handler);
    openServers.push(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing port.");

    const response = await nativeFetch(`http://127.0.0.1:${address.port}/api/health`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "ok" });
    expect(coordinationCommands.some((command) =>
      String(command[1]).includes("local value = redis.call('GET'")
    )).toBe(true);
    expect(coordinationCommands.some((command) =>
      String(command[1]).includes("ZCARD")
    )).toBe(true);
    expect(coordinationCommands.some((command) =>
      String(command[1]).includes("HINCRBY")
    )).toBe(true);
  });
});

function sharedCoordination() {
  return {
    scope: "shared" as const,
    admissions: new FixedWindowPublicRequestAdmission({
      requestsPerWindow: 60,
      maxConcurrentRequests: 8,
    }),
    modelBudget: new InMemoryPublicModelRequestBudget({
      maxRequestsPerWindow: 500,
      windowMilliseconds: 24 * 60 * 60 * 1_000,
    }),
    audits: { record: async () => undefined },
    telemetry: new InMemoryPublicOperationalTelemetry(),
    securityTelemetry: { record: async () => undefined },
  };
}

function coordinationEnvironment() {
  return {
    JOLENE_PUBLIC_COORDINATION_URL: "https://coordination.example.test",
    JOLENE_PUBLIC_COORDINATION_HOST: "coordination.example.test",
    JOLENE_PUBLIC_COORDINATION_TOKEN:
      "test-coordination-token-with-at-least-32-characters",
    JOLENE_PUBLIC_COORDINATION_NAMESPACE: "jolene-public",
    JOLENE_PUBLIC_CLIENT_HASH_KEY:
      "test-client-hash-key-with-at-least-32-characters",
  };
}

async function close(server: Server): Promise<void> {
  if (!server.listening) return;
  server.close();
  await once(server, "close");
}
