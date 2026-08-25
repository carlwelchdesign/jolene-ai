import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import type { ChannelKind } from "../domain/conversation.js";
import type {
  KnowledgeAccessRecord,
  KnowledgeAccessStatus,
  KnowledgeAccessStore,
  KnowledgeCitationRecord,
  ListKnowledgeAccessInput,
  RecordKnowledgeAccessInput,
} from "../domain/knowledge-audit.js";

interface AccessRow {
  readonly id: string;
  readonly event_id: string;
  readonly actor_id: string;
  readonly workspace_id: string;
  readonly channel_kind: ChannelKind;
  readonly channel_id: string;
  readonly thread_id: string;
  readonly query_fingerprint: string;
  readonly status: KnowledgeAccessStatus;
  readonly result_count: number;
  readonly error_code: string | null;
  readonly created_at: string;
}

interface CitationRow {
  readonly note_path: string;
  readonly heading: string;
  readonly modified_at: string;
  readonly score: number;
}

export class SqliteKnowledgeAccessStore implements KnowledgeAccessStore {
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

  recordAccess(input: RecordKnowledgeAccessInput): KnowledgeAccessRecord {
    assertAccessInput(input);
    const id = randomUUID();
    const createdAt = this.now().toISOString();
    const record = this.database.transaction(() => {
      this.database.prepare(
        `INSERT INTO knowledge_accesses
          (id, event_id, actor_id, workspace_id, channel_kind, channel_id,
           thread_id, query_fingerprint, status, result_count, error_code, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        input.eventId,
        input.actorId,
        input.workspaceId,
        input.channelKind,
        input.channelId,
        input.threadId,
        input.queryFingerprint,
        input.status,
        input.resultCount,
        input.errorCode,
        createdAt,
      );

      const insertCitation = this.database.prepare(
        `INSERT INTO knowledge_access_citations
          (access_id, ordinal, note_path, heading, modified_at, score)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      input.citations.forEach((citation, ordinal) => {
        insertCitation.run(
          id,
          ordinal,
          citation.notePath,
          citation.heading,
          citation.modifiedAt,
          citation.score,
        );
      });

      return this.requireAccess(id, input.actorId, input.workspaceId);
    });

    return record();
  }

  listAccesses(input: ListKnowledgeAccessInput): readonly KnowledgeAccessRecord[] {
    const rows = input.eventId
      ? this.database.prepare(
          `SELECT * FROM knowledge_accesses
           WHERE actor_id = ? AND workspace_id = ? AND event_id = ?
           ORDER BY created_at DESC, id DESC LIMIT ?`,
        ).all(input.actorId, input.workspaceId, input.eventId, input.limit) as AccessRow[]
      : this.database.prepare(
          `SELECT * FROM knowledge_accesses
           WHERE actor_id = ? AND workspace_id = ?
           ORDER BY created_at DESC, id DESC LIMIT ?`,
        ).all(input.actorId, input.workspaceId, input.limit) as AccessRow[];

    return rows.map((row) => this.mapAccess(row));
  }

  close(): void {
    this.database.close();
  }

  private requireAccess(
    id: string,
    actorId: string,
    workspaceId: string,
  ): KnowledgeAccessRecord {
    const row = this.database.prepare(
      `SELECT * FROM knowledge_accesses
       WHERE id = ? AND actor_id = ? AND workspace_id = ?`,
    ).get(id, actorId, workspaceId) as AccessRow | undefined;
    if (!row) throw new Error("Knowledge access record was not committed.");
    return this.mapAccess(row);
  }

  private mapAccess(row: AccessRow): KnowledgeAccessRecord {
    const citations = this.database.prepare(
      `SELECT note_path, heading, modified_at, score
       FROM knowledge_access_citations
       WHERE access_id = ? ORDER BY ordinal ASC`,
    ).all(row.id) as CitationRow[];

    return {
      id: row.id,
      eventId: row.event_id,
      actorId: row.actor_id,
      workspaceId: row.workspace_id,
      channelKind: row.channel_kind,
      channelId: row.channel_id,
      threadId: row.thread_id,
      queryFingerprint: row.query_fingerprint,
      status: row.status,
      resultCount: row.result_count,
      errorCode: row.error_code,
      citations: citations.map(mapCitation),
      createdAt: row.created_at,
    };
  }

  private migrate(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_accesses (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        channel_kind TEXT NOT NULL CHECK(channel_kind IN (
          'cli', 'private_chat', 'slack_dm', 'slack_private', 'slack_shared'
        )),
        channel_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        query_fingerprint TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('completed', 'failed')),
        result_count INTEGER NOT NULL CHECK(result_count >= 0),
        error_code TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS knowledge_accesses_scope_created
        ON knowledge_accesses(actor_id, workspace_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS knowledge_accesses_event
        ON knowledge_accesses(actor_id, workspace_id, event_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS knowledge_access_citations (
        access_id TEXT NOT NULL REFERENCES knowledge_accesses(id) ON DELETE CASCADE,
        ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
        note_path TEXT NOT NULL,
        heading TEXT NOT NULL,
        modified_at TEXT NOT NULL,
        score REAL NOT NULL,
        PRIMARY KEY (access_id, ordinal)
      );
    `);
  }
}

function mapCitation(row: CitationRow): KnowledgeCitationRecord {
  return {
    notePath: row.note_path,
    heading: row.heading,
    modifiedAt: row.modified_at,
    score: row.score,
  };
}

function assertAccessInput(input: RecordKnowledgeAccessInput): void {
  if (!/^[a-f0-9]{64}$/.test(input.queryFingerprint)) {
    throw new RangeError("Knowledge query fingerprint must be a SHA-256 digest.");
  }
  if (input.resultCount !== input.citations.length) {
    throw new RangeError("Knowledge result count must match retained citations.");
  }
  if (input.status === "completed" && input.errorCode !== null) {
    throw new RangeError("Completed knowledge access cannot retain an error code.");
  }
  if (
    input.status === "failed" &&
    (input.resultCount !== 0 || input.errorCode === null)
  ) {
    throw new RangeError("Failed knowledge access requires a bounded error and no results.");
  }
}
