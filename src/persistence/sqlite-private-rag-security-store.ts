import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import {
  privateRagDerivationSchema,
  privateRagRiskSignalSchema,
  type PrivateRagDerivation,
} from "../domain/private-rag-policy.js";
import type {
  InvalidatePrivateRagInput,
  PrivateRagInvalidationReport,
  PrivateRagQuarantineRecord,
  PrivateRagSecurityScope,
  PrivateRagSecurityStore,
  RecordPrivateRagQuarantineInput,
} from "../domain/private-rag-security.js";

interface QuarantineRow {
  readonly id: string;
  readonly event_id: string;
  readonly actor_id: string;
  readonly workspace_id: string;
  readonly parent_fingerprint: string;
  readonly taint_ids_json: string;
  readonly risk_signals_json: string;
  readonly status: "quarantined" | "released";
  readonly quarantined_at: string;
  readonly released_at: string | null;
}

interface DerivationRow {
  readonly id: string;
  readonly event_id: string;
  readonly actor_id: string;
  readonly workspace_id: string;
  readonly destination: PrivateRagDerivation["destination"];
  readonly output_fingerprint: string;
  readonly parent_fingerprints_json: string;
  readonly taint_ids_json: string;
  readonly status: PrivateRagDerivation["status"];
  readonly invalidation_reason: PrivateRagDerivation["invalidationReason"];
  readonly created_at: string;
  readonly invalidated_at: string | null;
}

export class SqlitePrivateRagSecurityStore implements PrivateRagSecurityStore {
  readonly #database: Database.Database;

  constructor(databasePath: string) {
    if (databasePath !== ":memory:") {
      fs.mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });
    }
    this.#database = new Database(databasePath);
    this.#database.pragma("journal_mode = WAL");
    this.#database.pragma("foreign_keys = ON");
    this.#migrate();
  }

  recordQuarantine(
    input: RecordPrivateRagQuarantineInput,
  ): PrivateRagQuarantineRecord {
    assertScope(input);
    const taintIds = parseIdentifiers(input.taintIds, "quarantine taint IDs");
    const riskSignals = privateRagRiskSignalSchema.array().min(1)
      .parse([...new Set(input.riskSignals)].sort());
    assertFingerprint(input.parentFingerprint);
    assertTimestamp(input.quarantinedAt);
    const existing = this.#database.prepare(
      `SELECT * FROM private_rag_quarantines
       WHERE actor_id = ? AND workspace_id = ? AND parent_fingerprint = ?`,
    ).get(
      input.actorId,
      input.workspaceId,
      input.parentFingerprint,
    ) as QuarantineRow | undefined;
    if (existing?.status === "quarantined") return mapQuarantine(existing);
    if (existing?.status === "released") {
      this.#database.prepare(
        `UPDATE private_rag_quarantines
         SET event_id = ?, taint_ids_json = ?, risk_signals_json = ?,
             status = 'quarantined', quarantined_at = ?, released_at = NULL
         WHERE id = ? AND status = 'released'`,
      ).run(
        input.eventId,
        JSON.stringify(taintIds),
        JSON.stringify(riskSignals),
        input.quarantinedAt,
        existing.id,
      );
      return this.#requireQuarantine(existing.id);
    }
    const id = randomUUID();
    this.#database.prepare(
      `INSERT INTO private_rag_quarantines
       (id, event_id, actor_id, workspace_id, parent_fingerprint,
        taint_ids_json, risk_signals_json, status, quarantined_at, released_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'quarantined', ?, NULL)`,
    ).run(
      id,
      input.eventId,
      input.actorId,
      input.workspaceId,
      input.parentFingerprint,
      JSON.stringify(taintIds),
      JSON.stringify(riskSignals),
      input.quarantinedAt,
    );
    return this.#requireQuarantine(id);
  }

  listActiveQuarantineTaintIds(scope: PrivateRagSecurityScope): readonly string[] {
    assertScope(scope);
    const rows = this.#database.prepare(
      `SELECT taint_ids_json FROM private_rag_quarantines
       WHERE actor_id = ? AND workspace_id = ? AND status = 'quarantined'`,
    ).all(scope.actorId, scope.workspaceId) as Array<{
      readonly taint_ids_json: string;
    }>;
    return Object.freeze([...new Set(rows.flatMap((row) =>
      parseIdentifierJson(row.taint_ids_json, "stored quarantine taint IDs")
    ))].sort());
  }

  listQuarantines(
    scope: PrivateRagSecurityScope,
    limit: number,
  ): readonly PrivateRagQuarantineRecord[] {
    assertScope(scope);
    const boundedLimit = boundedListLimit(limit);
    return (this.#database.prepare(
      `SELECT * FROM private_rag_quarantines
       WHERE actor_id = ? AND workspace_id = ?
       ORDER BY quarantined_at DESC, id DESC LIMIT ?`,
    ).all(scope.actorId, scope.workspaceId, boundedLimit) as QuarantineRow[])
      .map(mapQuarantine);
  }

  releaseQuarantineByTaint(
    scope: PrivateRagSecurityScope,
    taintId: string,
    releasedAt: string,
  ): number {
    assertScope(scope);
    const [parsedTaintId] = parseIdentifiers([taintId], "release taint ID");
    assertTimestamp(releasedAt);
    const active = this.#allQuarantines(scope).filter((record) =>
      record.status === "quarantined" && record.taintIds.includes(parsedTaintId!)
    );
    const update = this.#database.prepare(
      `UPDATE private_rag_quarantines
       SET status = 'released', released_at = ?
       WHERE id = ? AND status = 'quarantined'`,
    );
    const transaction = this.#database.transaction(() =>
      active.reduce((count, record) =>
        count + update.run(releasedAt, record.id).changes, 0)
    );
    return transaction();
  }

  recordDerivation(record: PrivateRagDerivation): PrivateRagDerivation {
    const parsed = privateRagDerivationSchema.parse(record);
    this.#database.prepare(
      `INSERT INTO private_rag_derivations
       (id, event_id, actor_id, workspace_id, destination, output_fingerprint,
        parent_fingerprints_json, taint_ids_json, status, invalidation_reason,
        created_at, invalidated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      parsed.id,
      parsed.eventId,
      parsed.actorId,
      parsed.workspaceId,
      parsed.destination,
      parsed.outputFingerprint,
      JSON.stringify(parsed.parentFingerprints),
      JSON.stringify(parsed.taintIds),
      parsed.status,
      parsed.invalidationReason,
      parsed.createdAt,
      parsed.invalidatedAt,
    );
    return this.#requireDerivation(parsed.id);
  }

  listDerivations(
    scope: PrivateRagSecurityScope,
    limit: number,
  ): readonly PrivateRagDerivation[] {
    assertScope(scope);
    return (this.#database.prepare(
      `SELECT * FROM private_rag_derivations
       WHERE actor_id = ? AND workspace_id = ?
       ORDER BY created_at DESC, id DESC LIMIT ?`,
    ).all(
      scope.actorId,
      scope.workspaceId,
      boundedListLimit(limit),
    ) as DerivationRow[]).map(mapDerivation);
  }

  invalidateDerivations(
    input: InvalidatePrivateRagInput,
  ): PrivateRagInvalidationReport {
    assertScope(input);
    const pending = new Set(input.parentFingerprints.map(assertFingerprint));
    assertTimestamp(input.invalidatedAt);
    const active = this.#activeDerivations(input);
    const invalidated: PrivateRagDerivation[] = [];
    let changed = true;
    while (changed) {
      changed = false;
      for (const record of active) {
        if (
          invalidated.some((item) => item.id === record.id) ||
          !record.parentFingerprints.some((parent) => pending.has(parent))
        ) continue;
        invalidated.push(record);
        pending.add(record.outputFingerprint);
        changed = true;
      }
    }
    const update = this.#database.prepare(
      `UPDATE private_rag_derivations
       SET status = 'invalidated', invalidation_reason = ?, invalidated_at = ?
       WHERE id = ? AND status = 'active'`,
    );
    this.#database.transaction(() => {
      for (const record of invalidated) {
        update.run(input.reason, input.invalidatedAt, record.id);
      }
    })();
    return Object.freeze({
      invalidatedIds: Object.freeze(invalidated.map((record) => record.id)),
      invalidatedOutputFingerprints: Object.freeze(
        invalidated.map((record) => record.outputFingerprint),
      ),
    });
  }

  resetTurn(
    scope: PrivateRagSecurityScope,
    eventId: string,
    invalidatedAt: string,
  ): PrivateRagInvalidationReport {
    assertScope(scope);
    if (!eventId.trim()) throw new RangeError("Private RAG reset event is invalid.");
    assertTimestamp(invalidatedAt);
    const roots = this.#activeDerivations(scope)
      .filter((record) => record.eventId === eventId)
      .map((record) => record);
    const update = this.#database.prepare(
      `UPDATE private_rag_derivations
       SET status = 'invalidated', invalidation_reason = 'turn_reset',
           invalidated_at = ?
       WHERE id = ? AND status = 'active'`,
    );
    this.#database.transaction(() => {
      for (const record of roots) update.run(invalidatedAt, record.id);
    })();
    const descendants = this.invalidateDerivations({
      ...scope,
      parentFingerprints: roots.map((record) => record.outputFingerprint),
      reason: "turn_reset",
      invalidatedAt,
    });
    return Object.freeze({
      invalidatedIds: Object.freeze([
        ...roots.map((record) => record.id),
        ...descendants.invalidatedIds,
      ]),
      invalidatedOutputFingerprints: Object.freeze([
        ...roots.map((record) => record.outputFingerprint),
        ...descendants.invalidatedOutputFingerprints,
      ]),
    });
  }

  close(): void {
    this.#database.close();
  }

  #requireQuarantine(id: string): PrivateRagQuarantineRecord {
    const row = this.#database.prepare(
      "SELECT * FROM private_rag_quarantines WHERE id = ?",
    ).get(id) as QuarantineRow | undefined;
    if (!row) throw new Error("Private RAG quarantine was not committed.");
    return mapQuarantine(row);
  }

  #requireDerivation(id: string): PrivateRagDerivation {
    const row = this.#database.prepare(
      "SELECT * FROM private_rag_derivations WHERE id = ?",
    ).get(id) as DerivationRow | undefined;
    if (!row) throw new Error("Private RAG derivation was not committed.");
    return mapDerivation(row);
  }

  #allQuarantines(
    scope: PrivateRagSecurityScope,
  ): readonly PrivateRagQuarantineRecord[] {
    return (this.#database.prepare(
      `SELECT * FROM private_rag_quarantines
       WHERE actor_id = ? AND workspace_id = ?`,
    ).all(scope.actorId, scope.workspaceId) as QuarantineRow[])
      .map(mapQuarantine);
  }

  #activeDerivations(
    scope: PrivateRagSecurityScope,
  ): readonly PrivateRagDerivation[] {
    return (this.#database.prepare(
      `SELECT * FROM private_rag_derivations
       WHERE actor_id = ? AND workspace_id = ? AND status = 'active'`,
    ).all(scope.actorId, scope.workspaceId) as DerivationRow[])
      .map(mapDerivation);
  }

  #migrate(): void {
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS private_rag_quarantines (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        parent_fingerprint TEXT NOT NULL,
        taint_ids_json TEXT NOT NULL,
        risk_signals_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('quarantined', 'released')),
        quarantined_at TEXT NOT NULL,
        released_at TEXT,
        UNIQUE(actor_id, workspace_id, parent_fingerprint),
        CHECK((status = 'quarantined' AND released_at IS NULL) OR
              (status = 'released' AND released_at IS NOT NULL))
      );
      CREATE INDEX IF NOT EXISTS private_rag_quarantines_scope_status
        ON private_rag_quarantines(actor_id, workspace_id, status, quarantined_at DESC);
      CREATE TABLE IF NOT EXISTS private_rag_derivations (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        destination TEXT NOT NULL CHECK(destination IN
          ('index', 'summary', 'cache', 'packet', 'model_copy')),
        output_fingerprint TEXT NOT NULL,
        parent_fingerprints_json TEXT NOT NULL,
        taint_ids_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('active', 'invalidated')),
        invalidation_reason TEXT,
        created_at TEXT NOT NULL,
        invalidated_at TEXT,
        UNIQUE(actor_id, workspace_id, output_fingerprint),
        CHECK((status = 'active' AND invalidation_reason IS NULL AND invalidated_at IS NULL) OR
              (status = 'invalidated' AND invalidation_reason IS NOT NULL AND invalidated_at IS NOT NULL))
      );
      CREATE INDEX IF NOT EXISTS private_rag_derivations_scope_status
        ON private_rag_derivations(actor_id, workspace_id, status, created_at DESC);
      CREATE INDEX IF NOT EXISTS private_rag_derivations_event
        ON private_rag_derivations(actor_id, workspace_id, event_id, created_at DESC);
    `);
  }
}

function mapQuarantine(row: QuarantineRow): PrivateRagQuarantineRecord {
  return Object.freeze({
    id: row.id,
    eventId: row.event_id,
    actorId: row.actor_id,
    workspaceId: row.workspace_id,
    parentFingerprint: assertFingerprint(row.parent_fingerprint),
    taintIds: Object.freeze(parseIdentifierJson(
      row.taint_ids_json,
      "stored quarantine taint IDs",
    )),
    riskSignals: Object.freeze(privateRagRiskSignalSchema.array().min(1)
      .parse(JSON.parse(row.risk_signals_json))),
    status: row.status,
    quarantinedAt: assertTimestamp(row.quarantined_at),
    releasedAt: row.released_at === null ? null : assertTimestamp(row.released_at),
  });
}

function mapDerivation(row: DerivationRow): PrivateRagDerivation {
  return privateRagDerivationSchema.parse({
    id: row.id,
    eventId: row.event_id,
    actorId: row.actor_id,
    workspaceId: row.workspace_id,
    destination: row.destination,
    outputFingerprint: row.output_fingerprint,
    parentFingerprints: JSON.parse(row.parent_fingerprints_json),
    taintIds: JSON.parse(row.taint_ids_json),
    status: row.status,
    invalidationReason: row.invalidation_reason,
    createdAt: row.created_at,
    invalidatedAt: row.invalidated_at,
  });
}

function assertScope(scope: PrivateRagSecurityScope): void {
  if (!scope.actorId.trim() || !scope.workspaceId.trim()) {
    throw new RangeError("Private RAG security scope is invalid.");
  }
}

function assertFingerprint(value: string): string {
  if (!/^sha256:[a-f0-9]{64}$/u.test(value)) {
    throw new RangeError("Private RAG fingerprint is invalid.");
  }
  return value;
}

function assertTimestamp(value: string): string {
  if (!Number.isFinite(Date.parse(value))) {
    throw new RangeError("Private RAG timestamp is invalid.");
  }
  return value;
}

function parseIdentifiers(values: readonly string[], label: string): string[] {
  const unique = [...new Set(values.map((value) => value.trim()))].sort();
  if (unique.length === 0 || unique.some((value) => !value || value.length > 512)) {
    throw new RangeError(`Private RAG ${label} are invalid.`);
  }
  return unique;
}

function parseIdentifierJson(value: string, label: string): string[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
    throw new Error(`Private RAG ${label} are corrupt.`);
  }
  return parseIdentifiers(parsed, label);
}

function boundedListLimit(value: number): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError("Private RAG list limit is invalid.");
  }
  return Math.min(value, 1_000);
}
