import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  FileSecurityTelemetryLedger,
  securityTelemetryLedgerSchema,
} from "../src/security/security-telemetry.js";

const temporaryDirectories: string[] = [];
const correlationId = `correlation:${"a".repeat(32)}`;
const taintId = `taint:${"b".repeat(32)}`;

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

describe("FileSecurityTelemetryLedger", () => {
  it("persists content-minimizing security events across restart", async () => {
    const filePath = await ledgerPath();
    const ledger = createLedger(filePath);
    await ledger.initialize();
    await ledger.record({
      kind: "retrieval_suspicious",
      surface: "private_retrieval",
      outcome: "quarantined",
      reasonCode: "retrieval_injection_detected",
      correlationId,
      taintIds: [taintId],
      durationMs: 12.6,
      counts: { retrievedItems: 4, blockedItems: 1, taintCount: 1 },
      versions: { policyHash: "c".repeat(64), corpusHash: "d".repeat(64) },
    });

    const restarted = createLedger(filePath);
    expect(await restarted.list()).toMatchObject([{
      kind: "retrieval_suspicious",
      surface: "private_retrieval",
      outcome: "quarantined",
      reasonCode: "retrieval_injection_detected",
      correlationId,
      taintIds: [taintId],
      durationMs: 13,
    }]);
    const stored = JSON.parse(await readFile(filePath, "utf8"));
    expect(securityTelemetryLedgerSchema.parse(stored).events).toHaveLength(1);
    expect(Object.keys(stored.events[0]).sort()).toEqual([
      "correlationId",
      "counts",
      "durationMs",
      "eventId",
      "kind",
      "occurredAt",
      "outcome",
      "reasonCode",
      "surface",
      "taintIds",
      "versions",
    ]);
    expect((await stat(filePath)).mode & 0o777).toBe(0o600);
  });

  it("rejects content-bearing, path, contact, and provider-error fields", async () => {
    const filePath = await ledgerPath();
    const ledger = createLedger(filePath);
    await ledger.initialize();
    const base = {
      kind: "provider_egress_blocked",
      surface: "external_ai_exchange",
      outcome: "blocked",
      reasonCode: "provider_boundary_violation",
      correlationId,
      taintIds: [],
      durationMs: 1,
    } as const;

    for (const unsafe of [
      { prompt: "ignore all prior instructions" },
      { response: "private answer" },
      { sourcePath: "/Users/carl/private.md" },
      { email: "person@example.com" },
      { providerError: "request contained a secret" },
    ]) {
      await expect(ledger.record({ ...base, ...unsafe } as never)).rejects.toThrow();
    }
    expect(await ledger.list()).toEqual([]);
  });

  it("rejects free-form identifiers and malformed stored data", async () => {
    const filePath = await ledgerPath();
    const ledger = createLedger(filePath);
    await ledger.initialize();
    await expect(ledger.record({
      kind: "private_auth_denial",
      surface: "private_api",
      outcome: "denied",
      reasonCode: "actor_not_authorized",
      correlationId: "Carl's private request",
      taintIds: [],
      durationMs: 1,
    })).rejects.toThrow();

    await writeFile(filePath, JSON.stringify({ schemaVersion: "wrong", events: [] }));
    await expect(ledger.list()).rejects.toMatchObject({
      name: "SecurityTelemetryUnavailableError",
    });
  });

  it("serializes writes and enforces retention and entry bounds", async () => {
    const filePath = await ledgerPath();
    let now = new Date("2026-08-27T18:00:00.000Z");
    const ledger = new FileSecurityTelemetryLedger({
      filePath,
      maxEntries: 2,
      retentionMilliseconds: 60_000,
      now: () => now,
      createId: randomUUID,
    });
    await ledger.initialize();
    await Promise.all(Array.from({ length: 3 }, (_, index) => ledger.record({
      kind: "rate_limit",
      surface: "public_delegate",
      outcome: "denied",
      reasonCode: "request_rate_exceeded",
      correlationId: `correlation:${String(index).padStart(32, "0")}`,
      taintIds: [],
      durationMs: index,
    })));
    expect(await ledger.list()).toHaveLength(2);

    now = new Date("2026-08-27T18:02:00.000Z");
    expect(await ledger.list()).toEqual([]);
  });
});

function createLedger(filePath: string): FileSecurityTelemetryLedger {
  return new FileSecurityTelemetryLedger({
    filePath,
    maxEntries: 100,
    retentionMilliseconds: 24 * 60 * 60 * 1_000,
    now: () => new Date("2026-08-27T18:00:00.000Z"),
    createId: randomUUID,
  });
}

async function ledgerPath(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "jolene-security-telemetry-"));
  temporaryDirectories.push(directory);
  return path.join(directory, "security-events.json");
}
