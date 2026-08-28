import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { RedisRestCoordinationClient } from "../src/public/redis-rest-coordination-client.js";
import {
  SharedPublicAuditTelemetry,
  SharedSecurityTelemetry,
  sharedObservabilityScriptFingerprints,
} from "../src/public/shared-public-observability.js";

const fixedNow = new Date("2026-08-27T21:00:00.000-07:00");

describe("SharedPublicAuditTelemetry", () => {
  it("atomically stores a strict event, counters, retention, and entry bounds", async () => {
    let command: unknown[] = [];
    const ledger = publicLedger(vi.fn<typeof globalThis.fetch>(async (_input, init) => {
      command = JSON.parse(String(init?.body));
      return jsonResponse({ result: 1 });
    }));
    await ledger.record({
      operation: "answer",
      method: "POST",
      status: 200,
      outcome: "model_supported",
      durationMs: 12.6,
      corpusVersion: `career:${"a".repeat(64)}`,
      counts: { claimCount: 3, citationCount: 3 },
    });

    expect(command[0]).toBe("EVAL");
    const script = String(command[1]);
    for (const operation of [
      "ZREMRANGEBYSCORE",
      "ZADD",
      "ZREMRANGEBYRANK",
      "HINCRBY",
      "PEXPIRE",
    ]) expect(script).toContain(operation);
    const serialized = JSON.stringify(command);
    expect(serialized).toContain("model_supported");
    expect(serialized).toContain('\\"claimCount\\":3');
    expect(serialized).not.toMatch(/question|answer text|client identity|\/Users\//i);
    expect(sharedObservabilityScriptFingerprints.publicAuditTelemetry)
      .toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects content-bearing fields before any network request", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const ledger = publicLedger(fetch);
    await expect(ledger.record({
      operation: "answer",
      method: "POST",
      status: 200,
      outcome: "supported",
      durationMs: 1,
      prompt: "private prompt",
    } as never)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fails closed on malformed counts and provider errors", async () => {
    for (const body of [{ result: 10_001 }, { error: "secret provider body" }]) {
      const ledger = publicLedger(vi.fn<typeof globalThis.fetch>(async () =>
        jsonResponse(body)
      ));
      await expect(ledger.record({
        operation: "health",
        method: "GET",
        status: 200,
        outcome: "ok",
        durationMs: 1,
      })).rejects.toThrow("Shared coordination is unavailable");
    }
  });
});

describe("SharedSecurityTelemetry", () => {
  it("stores only the closed security-event schema and fixed counters", async () => {
    let command: unknown[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
      command = JSON.parse(String(init?.body));
      return jsonResponse({ result: 1 });
    });
    const ledger = new SharedSecurityTelemetry({
      client: createClient(fetch),
      maxEntries: 100,
      retentionMilliseconds: 86_400_000,
      now: () => fixedNow,
      createId: () => randomUUID(),
    });
    await ledger.record({
      kind: "hosted_admission",
      surface: "public_delegate",
      capability: "public_delegate",
      outcome: "denied",
      reasonCode: "service_disabled",
      correlationId: `correlation:${"b".repeat(32)}`,
      taintIds: [],
      durationMs: 4,
      counts: { blockedItems: 1 },
      versions: { policyHash: "c".repeat(64) },
    });
    const serialized = JSON.stringify(command);
    expect(serialized).toContain("hosted_admission");
    expect(serialized).toContain("service_disabled");
    expect(serialized).not.toMatch(/prompt|response|contact|provider error|\/Users\//i);
  });

  it("rejects forbidden security content before storage", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const ledger = new SharedSecurityTelemetry({
      client: createClient(fetch),
      maxEntries: 100,
      retentionMilliseconds: 86_400_000,
    });
    await expect(ledger.record({
      kind: "hosted_admission",
      surface: "public_delegate",
      capability: "public_delegate",
      outcome: "denied",
      reasonCode: "service_disabled",
      correlationId: `correlation:${"b".repeat(32)}`,
      taintIds: [],
      durationMs: 4,
      providerError: "do not store me",
    } as never)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});

function publicLedger(fetch: typeof globalThis.fetch) {
  return new SharedPublicAuditTelemetry({
    client: createClient(fetch),
    maxEntries: 10_000,
    retentionMilliseconds: 30 * 24 * 60 * 60 * 1_000,
    now: () => fixedNow,
    createId: () => randomUUID(),
  });
}

function createClient(fetch: typeof globalThis.fetch) {
  return new RedisRestCoordinationClient({
    url: "https://coordination.example.test",
    token: "test-coordination-token-with-32-characters",
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
