import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import {
  CAPABILITY_IDS,
  requireCapability,
  type CapabilityId,
} from "../domain/capability-registry.js";
import type {
  CapabilityInvocationOutcome,
  CapabilityInvocationRecord,
  CapabilityInvocationStore,
  ListCapabilityInvocationsInput,
  RecordCapabilityInvocationInput,
} from "../domain/capability-invocation.js";

interface InvocationRow {
  readonly id: string;
  readonly event_id: string;
  readonly actor_id: string;
  readonly workspace_id: string;
  readonly capability_id: string;
  readonly tool_name: string;
  readonly outcome: CapabilityInvocationOutcome;
  readonly created_at: string;
}

export class SqliteCapabilityInvocationStore
  implements CapabilityInvocationStore
{
  private readonly database: Database.Database;

  constructor(
    databasePath: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (databasePath !== ":memory:") {
      fs.mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });
    }
    this.database = new Database(databasePath);
    this.database.pragma("journal_mode = WAL");
    this.migrate();
  }

  recordInvocation(
    input: RecordCapabilityInvocationInput,
  ): CapabilityInvocationRecord {
    assertInvocation(input);
    const record: CapabilityInvocationRecord = {
      id: randomUUID(),
      ...input,
      createdAt: this.now().toISOString(),
    };
    this.database.prepare(
      `INSERT INTO capability_invocations
        (id, event_id, actor_id, workspace_id, capability_id, tool_name,
         outcome, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      record.id,
      record.eventId,
      record.actorId,
      record.workspaceId,
      record.capabilityId,
      record.toolName,
      record.outcome,
      record.createdAt,
    );
    return this.requireInvocation(record.id);
  }

  listInvocations(
    input: ListCapabilityInvocationsInput,
  ): readonly CapabilityInvocationRecord[] {
    const limit = Math.max(1, Math.min(input.limit, 200));
    const rows = input.eventId
      ? this.database.prepare(
          `SELECT * FROM capability_invocations
           WHERE actor_id = ? AND workspace_id = ? AND event_id = ?
           ORDER BY created_at DESC, id DESC LIMIT ?`,
        ).all(input.actorId, input.workspaceId, input.eventId, limit)
      : this.database.prepare(
          `SELECT * FROM capability_invocations
           WHERE actor_id = ? AND workspace_id = ?
           ORDER BY created_at DESC, id DESC LIMIT ?`,
        ).all(input.actorId, input.workspaceId, limit);
    return (rows as InvocationRow[]).map(mapInvocation);
  }

  close(): void {
    this.database.close();
  }

  private requireInvocation(id: string): CapabilityInvocationRecord {
    const row = this.database.prepare(
      "SELECT * FROM capability_invocations WHERE id = ?",
    ).get(id) as InvocationRow | undefined;
    if (!row) throw new Error("Capability invocation record was not committed.");
    return mapInvocation(row);
  }

  private migrate(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS capability_invocations (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        capability_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        outcome TEXT NOT NULL CHECK(outcome IN ('completed', 'failed')),
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS capability_invocations_scope_created
        ON capability_invocations(
          actor_id, workspace_id, created_at DESC, id DESC
        );
      CREATE INDEX IF NOT EXISTS capability_invocations_event
        ON capability_invocations(
          actor_id, workspace_id, event_id, created_at DESC, id DESC
        );
    `);
  }
}

function assertInvocation(input: RecordCapabilityInvocationInput): void {
  if (!CAPABILITY_IDS.includes(input.capabilityId)) {
    throw new RangeError("Capability invocation ID is not registered.");
  }
  const capability = requireCapability(input.capabilityId);
  if (
    capability.runtime !== "model_read_only" ||
    capability.modelToolName !== input.toolName
  ) {
    throw new RangeError("Capability invocation tool does not match the registry.");
  }
  for (const [label, value] of [
    ["event", input.eventId],
    ["actor", input.actorId],
    ["workspace", input.workspaceId],
  ] as const) {
    if (!value.trim() || value.length > 240) {
      throw new RangeError(`Capability invocation ${label} is invalid.`);
    }
  }
}

function mapInvocation(row: InvocationRow): CapabilityInvocationRecord {
  const capabilityId = parseCapabilityId(row.capability_id);
  const capability = requireCapability(capabilityId);
  if (capability.modelToolName !== row.tool_name) {
    throw new Error("Stored capability invocation disagrees with the registry.");
  }
  return {
    id: row.id,
    eventId: row.event_id,
    actorId: row.actor_id,
    workspaceId: row.workspace_id,
    capabilityId,
    toolName: row.tool_name,
    outcome: row.outcome,
    createdAt: row.created_at,
  };
}

function parseCapabilityId(value: string): CapabilityId {
  const capabilityId = CAPABILITY_IDS.find((candidate) => candidate === value);
  if (!capabilityId) {
    throw new Error("Stored capability invocation is not registered.");
  }
  return capabilityId;
}
