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
  CapabilityAuthorizationOutcome,
  CapabilityAuthorizationRecord,
  CapabilityInvocationOutcome,
  CapabilityInvocationRecord,
  CapabilityInvocationStore,
  ListCapabilityInvocationsInput,
  RecordCapabilityAuthorizationInput,
  RecordCapabilityInvocationInput,
} from "../domain/capability-invocation.js";
import { toolAuthorizationDenialReasonSchema } from
  "../domain/tool-call-authorization.js";

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

interface AuthorizationRow {
  readonly id: string;
  readonly event_id: string;
  readonly actor_id: string;
  readonly workspace_id: string;
  readonly capability_id: string;
  readonly tool_name: string;
  readonly outcome: CapabilityAuthorizationOutcome;
  readonly reason_code: string | null;
  readonly authorization_id: string | null;
  readonly arguments_fingerprint: string | null;
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

  recordAuthorization(
    input: RecordCapabilityAuthorizationInput,
  ): CapabilityAuthorizationRecord {
    assertAuthorization(input);
    const record: CapabilityAuthorizationRecord = {
      id: randomUUID(),
      ...input,
      createdAt: this.now().toISOString(),
    };
    this.database.prepare(
      `INSERT INTO capability_authorizations
        (id, event_id, actor_id, workspace_id, capability_id, tool_name,
         outcome, reason_code, authorization_id, arguments_fingerprint,
         created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      record.id,
      record.eventId,
      record.actorId,
      record.workspaceId,
      record.capabilityId,
      record.toolName,
      record.outcome,
      record.reasonCode,
      record.authorizationId,
      record.argumentsFingerprint,
      record.createdAt,
    );
    return this.requireAuthorization(record.id);
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

  listAuthorizations(
    input: ListCapabilityInvocationsInput,
  ): readonly CapabilityAuthorizationRecord[] {
    const limit = Math.max(1, Math.min(input.limit, 200));
    const rows = input.eventId
      ? this.database.prepare(
          `SELECT * FROM capability_authorizations
           WHERE actor_id = ? AND workspace_id = ? AND event_id = ?
           ORDER BY created_at DESC, id DESC LIMIT ?`,
        ).all(input.actorId, input.workspaceId, input.eventId, limit)
      : this.database.prepare(
          `SELECT * FROM capability_authorizations
           WHERE actor_id = ? AND workspace_id = ?
           ORDER BY created_at DESC, id DESC LIMIT ?`,
        ).all(input.actorId, input.workspaceId, limit);
    return (rows as AuthorizationRow[]).map(mapAuthorization);
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

  private requireAuthorization(id: string): CapabilityAuthorizationRecord {
    const row = this.database.prepare(
      "SELECT * FROM capability_authorizations WHERE id = ?",
    ).get(id) as AuthorizationRow | undefined;
    if (!row) throw new Error("Capability authorization record was not committed.");
    return mapAuthorization(row);
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
      CREATE TABLE IF NOT EXISTS capability_authorizations (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        capability_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        outcome TEXT NOT NULL CHECK(outcome IN ('allowed', 'denied')),
        reason_code TEXT,
        authorization_id TEXT,
        arguments_fingerprint TEXT,
        created_at TEXT NOT NULL,
        CHECK(
          (outcome = 'allowed' AND reason_code IS NULL AND
           authorization_id IS NOT NULL AND arguments_fingerprint IS NOT NULL) OR
          (outcome = 'denied' AND reason_code IS NOT NULL AND
           arguments_fingerprint IS NULL)
        )
      );
      CREATE INDEX IF NOT EXISTS capability_authorizations_scope_created
        ON capability_authorizations(
          actor_id, workspace_id, created_at DESC, id DESC
        );
      CREATE INDEX IF NOT EXISTS capability_authorizations_event
        ON capability_authorizations(
          actor_id, workspace_id, event_id, created_at DESC, id DESC
        );
    `);
  }
}

function assertInvocation(input: RecordCapabilityInvocationInput): void {
  assertCapabilityIdentity(input);
}

function assertAuthorization(input: RecordCapabilityAuthorizationInput): void {
  assertCapabilityIdentity(input);
  if (input.outcome === "allowed") {
    if (
      input.reasonCode !== null ||
      !input.authorizationId?.match(/^[0-9a-f-]{36}$/u) ||
      !input.argumentsFingerprint?.match(/^sha256:[a-f0-9]{64}$/u)
    ) {
      throw new RangeError("Allowed capability authorization metadata is invalid.");
    }
    return;
  }
  if (
    !toolAuthorizationDenialReasonSchema.safeParse(input.reasonCode).success ||
    input.argumentsFingerprint !== null
  ) {
    throw new RangeError("Denied capability authorization metadata is invalid.");
  }
  if (input.authorizationId !== null &&
      !input.authorizationId.match(/^[0-9a-f-]{36}$/u)) {
    throw new RangeError("Denied capability authorization ID is invalid.");
  }
}

function assertCapabilityIdentity(input: {
  readonly eventId: string;
  readonly actorId: string;
  readonly workspaceId: string;
  readonly capabilityId: CapabilityId;
  readonly toolName: string;
}): void {
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

function mapAuthorization(row: AuthorizationRow): CapabilityAuthorizationRecord {
  const capabilityId = parseCapabilityId(row.capability_id);
  const capability = requireCapability(capabilityId);
  if (capability.modelToolName !== row.tool_name) {
    throw new Error("Stored capability authorization disagrees with the registry.");
  }
  return {
    id: row.id,
    eventId: row.event_id,
    actorId: row.actor_id,
    workspaceId: row.workspace_id,
    capabilityId,
    toolName: row.tool_name,
    outcome: row.outcome,
    reasonCode: row.reason_code === null
      ? null
      : toolAuthorizationDenialReasonSchema.parse(row.reason_code),
    authorizationId: row.authorization_id,
    argumentsFingerprint: row.arguments_fingerprint,
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
