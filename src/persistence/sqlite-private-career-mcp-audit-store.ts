import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import type { CareerEvidenceScope } from "../domain/career-evidence.js";
import {
  PRIVATE_CAREER_MCP_TOOLS,
  type PrivateCareerMcpAccessRecord,
  type PrivateCareerMcpAuditStore,
  type PrivateCareerMcpOutcome,
  type PrivateCareerMcpTool,
  type RecordPrivateCareerMcpAccessInput,
} from "../domain/private-career-mcp.js";

interface AccessRow {
  readonly id: string;
  readonly event_id: string;
  readonly actor_id: string;
  readonly workspace_id: string;
  readonly client_id: string;
  readonly tool: PrivateCareerMcpTool;
  readonly request_fingerprint: string;
  readonly outcome: PrivateCareerMcpOutcome;
  readonly result_count: number;
  readonly error_code: string | null;
  readonly created_at: string;
}

interface EvidenceRow {
  readonly evidence_id: string;
}

export class SqlitePrivateCareerMcpAuditStore
  implements PrivateCareerMcpAuditStore
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
    this.database.pragma("foreign_keys = ON");
    this.migrate();
  }

  recordAccess(
    input: RecordPrivateCareerMcpAccessInput,
  ): PrivateCareerMcpAccessRecord {
    assertAccessInput(input);
    const id = randomUUID();
    const createdAt = this.now().toISOString();
    return this.database.transaction(() => {
      this.database.prepare(
        `INSERT INTO private_career_mcp_accesses
          (id, event_id, actor_id, workspace_id, client_id, tool,
           request_fingerprint, outcome, result_count, error_code, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        input.eventId,
        input.actorId,
        input.workspaceId,
        input.clientId,
        input.tool,
        input.requestFingerprint,
        input.outcome,
        input.resultCount,
        input.errorCode,
        createdAt,
      );
      const insertEvidence = this.database.prepare(
        `INSERT INTO private_career_mcp_access_evidence
          (access_id, ordinal, evidence_id) VALUES (?, ?, ?)`,
      );
      input.evidenceIds.forEach((evidenceId, ordinal) => {
        insertEvidence.run(id, ordinal, evidenceId);
      });
      return this.requireAccess(id);
    })();
  }

  listAccesses(
    scope: CareerEvidenceScope,
    clientId: string,
    limit: number,
  ): readonly PrivateCareerMcpAccessRecord[] {
    const boundedLimit = Math.max(1, Math.min(limit, 200));
    const rows = this.database.prepare(
      `SELECT * FROM private_career_mcp_accesses
       WHERE actor_id = ? AND workspace_id = ? AND client_id = ?
       ORDER BY created_at DESC, id DESC LIMIT ?`,
    ).all(
      scope.actorId,
      scope.workspaceId,
      clientId,
      boundedLimit,
    ) as AccessRow[];
    return rows.map((row) => this.mapAccess(row));
  }

  close(): void {
    this.database.close();
  }

  private requireAccess(id: string): PrivateCareerMcpAccessRecord {
    const row = this.database.prepare(
      "SELECT * FROM private_career_mcp_accesses WHERE id = ?",
    ).get(id) as AccessRow | undefined;
    if (!row) throw new Error("Private career MCP audit record was not committed.");
    return this.mapAccess(row);
  }

  private mapAccess(row: AccessRow): PrivateCareerMcpAccessRecord {
    const evidence = this.database.prepare(
      `SELECT evidence_id FROM private_career_mcp_access_evidence
       WHERE access_id = ? ORDER BY ordinal ASC`,
    ).all(row.id) as EvidenceRow[];
    return {
      id: row.id,
      eventId: row.event_id,
      actorId: row.actor_id,
      workspaceId: row.workspace_id,
      clientId: row.client_id,
      tool: row.tool,
      requestFingerprint: row.request_fingerprint,
      outcome: row.outcome,
      resultCount: row.result_count,
      evidenceIds: evidence.map((item) => item.evidence_id),
      errorCode: row.error_code,
      createdAt: row.created_at,
    };
  }

  private migrate(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS private_career_mcp_accesses (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        client_id TEXT NOT NULL,
        tool TEXT NOT NULL CHECK(tool IN (
          'career_search', 'career_inspect', 'career_compare_job'
        )),
        request_fingerprint TEXT NOT NULL,
        outcome TEXT NOT NULL CHECK(outcome IN ('completed', 'refused', 'failed')),
        result_count INTEGER NOT NULL CHECK(result_count >= 0),
        error_code TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS private_career_mcp_accesses_scope
        ON private_career_mcp_accesses(
          actor_id, workspace_id, client_id, created_at DESC
        );
      CREATE TABLE IF NOT EXISTS private_career_mcp_access_evidence (
        access_id TEXT NOT NULL REFERENCES private_career_mcp_accesses(id)
          ON DELETE CASCADE,
        ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
        evidence_id TEXT NOT NULL,
        PRIMARY KEY (access_id, ordinal)
      );
    `);
  }
}

function assertAccessInput(input: RecordPrivateCareerMcpAccessInput): void {
  if (!PRIVATE_CAREER_MCP_TOOLS.includes(input.tool)) {
    throw new RangeError("Private career MCP audit tool is invalid.");
  }
  if (!/^[a-f0-9]{64}$/.test(input.requestFingerprint)) {
    throw new RangeError("Private career MCP request fingerprint must be a SHA-256 digest.");
  }
  if (new Set(input.evidenceIds).size !== input.evidenceIds.length) {
    throw new RangeError("Private career MCP audit evidence IDs must be unique.");
  }
  if (!input.evidenceIds.every((id) => /^[a-f0-9-]{36}$/.test(id))) {
    throw new RangeError("Private career MCP audit evidence IDs must be UUIDs.");
  }
  if (input.resultCount !== input.evidenceIds.length) {
    throw new RangeError("Private career MCP result count must match evidence IDs.");
  }
  if (
    (input.outcome === "completed" && input.errorCode !== null) ||
    (input.outcome !== "completed" && input.errorCode === null)
  ) {
    throw new RangeError("Private career MCP audit outcome and error code disagree.");
  }
}
