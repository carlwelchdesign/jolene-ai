import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  FilePublicAuditLedger,
  publicAuditLedgerSchema,
} from "../src/public/public-audit-ledger.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    ),
  );
});

describe("FilePublicAuditLedger", () => {
  it("persists strict content-minimizing events across restart", async () => {
    const filePath = await auditPath();
    const ledger = createLedger(filePath);
    await ledger.initialize();
    await ledger.record({
      operation: "answer",
      method: "POST",
      status: 200,
      outcome: "supported",
      durationMs: 12.4,
      corpusVersion: `career:${"a".repeat(64)}`,
      counts: { claimCount: 2, citationCount: 2 },
    });

    const restarted = createLedger(filePath);
    expect(await restarted.list()).toMatchObject([{
      operation: "answer",
      method: "POST",
      status: 200,
      outcome: "supported",
      durationMs: 12,
      counts: { claimCount: 2, citationCount: 2 },
    }]);
    const stored = JSON.parse(await readFile(filePath, "utf8"));
    expect(publicAuditLedgerSchema.parse(stored).events).toHaveLength(1);
    expect(Object.keys(stored.events[0]).sort()).toEqual([
      "corpusVersion",
      "counts",
      "durationMs",
      "eventId",
      "method",
      "occurredAt",
      "operation",
      "outcome",
      "status",
    ]);
    expect((await stat(filePath)).mode & 0o777).toBe(0o600);
  });

  it("serializes concurrent writes without losing events", async () => {
    const filePath = await auditPath();
    const ledger = createLedger(filePath);
    await ledger.initialize();
    await Promise.all(Array.from({ length: 20 }, (_, index) => ledger.record({
      operation: "manifest",
      method: "GET",
      status: 200,
      outcome: "ok",
      durationMs: index,
    })));

    expect(await ledger.list()).toHaveLength(20);
  });

  it("enforces retention and maximum-entry bounds", async () => {
    const filePath = await auditPath();
    let now = new Date("2026-08-26T18:00:00.000Z");
    const ledger = new FilePublicAuditLedger({
      filePath,
      maxEntries: 2,
      retentionMilliseconds: 60_000,
      now: () => now,
      createId: randomUUID,
    });
    await ledger.initialize();
    for (const outcome of ["not_found", "rate_limited", "busy"] as const) {
      await ledger.record({
        operation: "unknown",
        method: "OTHER",
        status: outcome === "not_found" ? 404 : outcome === "rate_limited" ? 429 : 503,
        outcome,
        durationMs: 1,
      });
      now = new Date(now.getTime() + 1_000);
    }
    expect((await ledger.list()).map((event) => event.outcome)).toEqual([
      "rate_limited",
      "busy",
    ]);

    now = new Date("2026-08-26T18:02:00.000Z");
    expect(await ledger.list()).toEqual([]);
  });

  it("rejects unknown fields and malformed stored data", async () => {
    const filePath = await auditPath();
    const ledger = createLedger(filePath);
    await ledger.initialize();
    await expect(ledger.record({
      operation: "answer",
      method: "POST",
      status: 200,
      outcome: "supported",
      durationMs: 1,
      question: "This must never be retained",
    } as never)).rejects.toThrow();

    await writeFile(filePath, JSON.stringify({ schemaVersion: "wrong", events: [] }));
    await expect(ledger.list()).rejects.toMatchObject({
      name: "PublicAuditUnavailableError",
    });
  });
});

function createLedger(filePath: string): FilePublicAuditLedger {
  return new FilePublicAuditLedger({
    filePath,
    maxEntries: 100,
    retentionMilliseconds: 24 * 60 * 60 * 1_000,
    now: () => new Date("2026-08-26T18:00:00.000Z"),
    createId: randomUUID,
  });
}

async function auditPath(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "jolene-public-audit-"));
  temporaryDirectories.push(directory);
  return path.join(directory, "audit.json");
}
