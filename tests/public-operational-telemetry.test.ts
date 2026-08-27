import { describe, expect, it } from "vitest";

import {
  InMemoryPublicOperationalTelemetry,
  publicOperationalSnapshotSchema,
} from "../src/public/public-operational-telemetry.js";

describe("public operational telemetry", () => {
  it("accounts for fixed request dimensions, concurrency, and bounded latency", () => {
    let now = new Date("2026-08-27T03:00:00.000Z");
    const telemetry = new InMemoryPublicOperationalTelemetry({ now: () => now });
    const first = telemetry.begin({ operation: "answer", method: "POST" });
    const second = telemetry.begin({ operation: "health", method: "GET" });

    expect(telemetry.snapshot()).toMatchObject({
      totalRequests: 0,
      inFlight: 2,
      highWaterInFlight: 2,
    });

    now = new Date("2026-08-27T03:00:00.025Z");
    first.complete({ status: 200, outcome: "supported" });
    first.complete({ status: 500, outcome: "public_evidence_unavailable" });
    now = new Date("2026-08-27T03:02:00.000Z");
    second.complete({ status: 503, outcome: "public_evidence_unavailable" });

    expect(telemetry.snapshot()).toMatchObject({
      schemaVersion: "jolene.public-operations.v1",
      startedAt: "2026-08-27T03:00:00.000Z",
      observedAt: "2026-08-27T03:02:00.000Z",
      totalRequests: 2,
      inFlight: 0,
      highWaterInFlight: 2,
      statusClasses: {
        informational: 0,
        successful: 1,
        redirection: 0,
        clientError: 0,
        serverError: 1,
      },
      operations: { answer: 1, health: 1 },
      methods: { GET: 1, POST: 1, OTHER: 0 },
      outcomes: { supported: 1, public_evidence_unavailable: 1 },
      latency: {
        count: 2,
        sumMs: 60_025,
        maxMs: 60_000,
      },
    });
    expect(telemetry.snapshot().latency.buckets.at(-1)).toEqual({
      leMs: 30_000,
      count: 1,
    });
  });

  it("emits a strict aggregate schema with no content or client dimensions", () => {
    const snapshot = new InMemoryPublicOperationalTelemetry().snapshot();
    expect(publicOperationalSnapshotSchema.parse(snapshot)).toEqual(snapshot);
    expect(Object.keys(snapshot)).not.toEqual(expect.arrayContaining([
      "question",
      "answer",
      "description",
      "contact",
      "email",
      "address",
      "headers",
      "body",
      "url",
      "citations",
      "claims",
      "stack",
      "requestId",
    ]));
    expect(JSON.stringify(snapshot)).not.toContain("private submitted content");
    expect(() => publicOperationalSnapshotSchema.parse({
      ...snapshot,
      clientAddress: "127.0.0.1",
    })).toThrow();
  });
});
