import { once } from "node:events";
import type { Server } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildPublicReadinessSnapshot,
  createPublicOperationsServer,
} from "../src/public/public-operations-server.js";
import {
  InMemoryPublicOperationalTelemetry,
} from "../src/public/public-operational-telemetry.js";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(close));
});

describe("private public-delegate operations server", () => {
  it("serves content-minimizing liveness, readiness, and metrics", async () => {
    const telemetry = new InMemoryPublicOperationalTelemetry({
      now: () => new Date("2026-08-27T03:00:00.000Z"),
    });
    const server = await start(createPublicOperationsServer({
      telemetry,
      now: () => new Date("2026-08-27T02:59:00.000Z"),
      readiness: async () => buildPublicReadinessSnapshot({
        checkedAt: new Date("2026-08-27T03:00:00.000Z"),
        delegateEnabled: true,
        publicEvidenceReady: true,
        contactIntentQueueReady: true,
        auditLedgerReady: false,
        modelRequestBudget: "not_required",
      }),
    }));
    const baseUrl = address(server);

    expect(await response(`${baseUrl}/live`)).toMatchObject({
      status: 200,
      body: {
        schemaVersion: "jolene.public-operations.v1",
        status: "alive",
        startedAt: "2026-08-27T02:59:00.000Z",
      },
    });
    expect(await response(`${baseUrl}/ready`)).toMatchObject({
      status: 200,
      body: {
        status: "degraded",
        components: {
          publicEvidence: "ready",
          auditLedger: "degraded",
        },
      },
    });
    expect(await response(`${baseUrl}/metrics`)).toMatchObject({
      status: 200,
      body: { totalRequests: 0, inFlight: 0 },
    });
  });

  it("fails readiness closed and rejects unsupported methods and routes", async () => {
    const server = await start(createPublicOperationsServer({
      telemetry: new InMemoryPublicOperationalTelemetry(),
      readiness: async () => buildPublicReadinessSnapshot({
        checkedAt: new Date(),
        delegateEnabled: true,
        publicEvidenceReady: false,
        contactIntentQueueReady: true,
        auditLedgerReady: true,
        modelRequestBudget: "ready",
      }),
    }));
    const baseUrl = address(server);

    expect(await response(`${baseUrl}/ready`)).toMatchObject({
      status: 503,
      body: { status: "unready", components: { publicEvidence: "unavailable" } },
    });
    expect(await response(`${baseUrl}/unknown`)).toMatchObject({
      status: 404,
      body: { status: "not_found" },
    });
    const rejected = await fetch(`${baseUrl}/metrics`, { method: "POST" });
    expect(rejected.status).toBe(405);
    expect(rejected.headers.get("allow")).toBe("GET");
  });

  it("does not disclose readiness probe failures", async () => {
    const server = await start(createPublicOperationsServer({
      telemetry: new InMemoryPublicOperationalTelemetry(),
      readiness: async () => {
        throw new Error("/private/path secret provider detail");
      },
    }));
    const result = await response(`${address(server)}/ready`);
    expect(result).toMatchObject({
      status: 503,
      body: { status: "readiness_unavailable" },
    });
    expect(JSON.stringify(result.body)).not.toContain("private/path");
  });

  it("does not disclose telemetry snapshot failures", async () => {
    const server = await start(createPublicOperationsServer({
      telemetry: {
        begin: () => ({ complete: () => undefined }),
        snapshot: () => {
          throw new Error("submitted answer and private client detail");
        },
      },
      readiness: async () => {
        throw new Error("unused");
      },
    }));
    const result = await response(`${address(server)}/metrics`);
    expect(result).toMatchObject({
      status: 503,
      body: { status: "operations_unavailable" },
    });
    expect(JSON.stringify(result.body)).not.toContain("submitted answer");
  });
});

async function start(server: Server): Promise<Server> {
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server;
}

function address(server: Server): string {
  const bound = server.address();
  if (!bound || typeof bound === "string") throw new Error("Expected TCP server.");
  return `http://127.0.0.1:${bound.port}`;
}

async function response(url: string) {
  const result = await fetch(url);
  return { status: result.status, body: await result.json() };
}

async function close(server: Server): Promise<void> {
  if (!server.listening) return;
  server.close();
  await once(server, "close");
}
