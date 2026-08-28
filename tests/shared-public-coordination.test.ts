import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { RedisRestCoordinationClient } from "../src/public/redis-rest-coordination-client.js";
import {
  PreflightedPublicRequestAdmission,
  SharedPublicModelRequestBudget,
  SharedPublicRequestAdmission,
  sharedPublicCoordinationScriptFingerprints,
} from "../src/public/shared-public-coordination.js";

const endpoint = "https://coordination.example.test";
const token = "test-coordination-token-with-32-characters";
const clientHashKey = "test-client-hash-key-with-at-least-32-characters";

describe("SharedPublicRequestAdmission", () => {
  it("sends only a client HMAC and acquires/releases one opaque lease", async () => {
    const requests: unknown[] = [];
    const leaseId = randomUUID();
    const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      requests.push(body);
      return jsonResponse({ result: requests.length === 1 ? [1, leaseId] : 1 });
    });
    const admission = createAdmission(fetch, leaseId);
    const clientIdentity = "203.0.113.10 and private visitor marker";

    const result = await admission.acquire(clientIdentity);
    expect(result.accepted).toBe(true);
    if (!result.accepted) throw new Error("Expected accepted admission.");
    await result.release();
    await result.release();

    expect(fetch).toHaveBeenCalledTimes(2);
    const serialized = JSON.stringify(requests);
    expect(serialized).not.toContain(clientIdentity);
    expect(serialized).not.toContain("203.0.113.10");
    expect(serialized).toMatch(/client-[a-f0-9]{32}/);
    expect(serialized.match(new RegExp(leaseId, "g"))).toHaveLength(2);
  });

  it("maps atomic rate and concurrency refusals exactly", async () => {
    for (const [providerResult, expected] of [
      [[0, 429, 17], { status: 429, code: "rate_limited", retryAfterSeconds: 17 }],
      [[0, 503, 1], { status: 503, code: "public_delegate_busy", retryAfterSeconds: 1 }],
    ] as const) {
      const admission = createAdmission(vi.fn<typeof globalThis.fetch>(async () =>
        jsonResponse({ result: providerResult })
      ));
      await expect(admission.acquire("client-key")).resolves.toMatchObject({
        accepted: false,
        ...expected,
      });
    }
  });

  it("fails closed for provider errors and malformed atomic results", async () => {
    for (const response of [
      jsonResponse({ error: "provider internals and private input" }),
      jsonResponse({ result: [1, "not-a-uuid"] }),
      new Response("unavailable", { status: 503 }),
    ]) {
      const admission = createAdmission(vi.fn<typeof globalThis.fetch>(async () => response));
      await expect(admission.acquire("client-key")).rejects.toThrow(
        "Shared coordination is unavailable",
      );
    }
  });

  it("uses bounded expiry and atomic cleanup in the versioned script", async () => {
    let command: unknown[] = [];
    const admission = createAdmission(vi.fn<typeof globalThis.fetch>(async (_input, init) => {
      command = JSON.parse(String(init?.body));
      return jsonResponse({ result: [0, 503, 1] });
    }));
    await admission.acquire("client-key");
    const script = String(command[1]);
    expect(script).toContain("ZREMRANGEBYSCORE");
    expect(script).toContain("ZCARD");
    expect(script).toContain("HMGET");
    expect(script).toContain("PEXPIRE");
    expect(script).toContain("ZADD");
    expect(sharedPublicCoordinationScriptFingerprints.admission)
      .toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("PreflightedPublicRequestAdmission", () => {
  it("coalesces and caches protocol preflight before delegating", async () => {
    let now = 1_000;
    let fetchCalls = 0;
    const client = createClient(vi.fn<typeof globalThis.fetch>(async (_input, init) => {
      fetchCalls += 1;
      const body = JSON.parse(String(init?.body));
      if (body[0] === "EVAL") return jsonResponse({ result: body.at(-1) });
      return jsonResponse([{ result: "PONG" }, { result: body[1][1] }]);
    }));
    const delegate = {
      acquire: vi.fn(async () => ({ accepted: false as const, status: 503 as const,
        code: "public_delegate_busy" as const, retryAfterSeconds: 1 })),
    };
    const admission = new PreflightedPublicRequestAdmission({
      client,
      delegate,
      freshnessMilliseconds: 1_000,
      now: () => now,
    });

    await Promise.all([admission.acquire("a"), admission.acquire("b")]);
    expect(fetchCalls).toBe(2);
    expect(delegate.acquire).toHaveBeenCalledTimes(2);
    await admission.acquire("c");
    expect(fetchCalls).toBe(2);
    now = 2_001;
    await admission.acquire("d");
    expect(fetchCalls).toBe(4);
  });

  it("never delegates when preflight is unavailable", async () => {
    const delegate = { acquire: vi.fn() };
    const admission = new PreflightedPublicRequestAdmission({
      client: createClient(vi.fn<typeof globalThis.fetch>(async () =>
        new Response("unavailable", { status: 503 })
      )),
      delegate,
    });
    await expect(admission.acquire("client")).rejects.toThrow(
      "Shared coordination is unavailable",
    );
    expect(delegate.acquire).not.toHaveBeenCalled();
  });
});

describe("SharedPublicModelRequestBudget", () => {
  it("reserves atomically and distinguishes exhaustion from outage", async () => {
    const results = [1, 0, "bad"];
    const commands: unknown[][] = [];
    const client = createClient(vi.fn<typeof globalThis.fetch>(async (_input, init) => {
      commands.push(JSON.parse(String(init?.body)));
      return jsonResponse({ result: results.shift() });
    }));
    const budget = new SharedPublicModelRequestBudget({
      client,
      maxRequestsPerWindow: 500,
      windowMilliseconds: 86_400_000,
    });
    await expect(budget.reserve()).resolves.toBe(true);
    await expect(budget.reserve()).resolves.toBe(false);
    await expect(budget.reserve()).rejects.toThrow("Shared coordination is unavailable");
    const script = String(commands[0]?.[1]);
    expect(script).toContain("GET");
    expect(script).toContain("INCR");
    expect(script).toContain("PEXPIRE");
  });
});

function createAdmission(fetch: typeof globalThis.fetch, leaseId = randomUUID()) {
  return new SharedPublicRequestAdmission({
    client: createClient(fetch),
    clientHashKey,
    requestsPerWindow: 60,
    maxConcurrentRequests: 8,
    windowMilliseconds: 60_000,
    leaseMilliseconds: 15_000,
    now: () => 1_777_777_777_000,
    createLeaseId: () => leaseId,
  });
}

function createClient(fetch: typeof globalThis.fetch) {
  return new RedisRestCoordinationClient({
    url: endpoint,
    token,
    allowedHosts: ["coordination.example.test"],
    namespace: "jolene-public",
    fetch,
  });
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
