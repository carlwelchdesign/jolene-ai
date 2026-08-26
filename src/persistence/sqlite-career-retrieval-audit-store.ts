import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import type { ChannelKind } from "../domain/conversation.js";
import type { CareerEvidenceScope } from "../domain/career-evidence.js";
import type {
  CareerRetrievalAccessRecord,
  CareerRetrievalAuditStore,
  CareerRetrievalMode,
  RecordCareerRetrievalAccessInput,
} from "../domain/career-retrieval.js";

interface AccessRow {
  readonly id: string;
  readonly event_id: string;
  readonly actor_id: string;
  readonly workspace_id: string;
  readonly corpus_actor_id: string;
  readonly corpus_workspace_id: string;
  readonly channel_kind: ChannelKind;
  readonly channel_id: string;
  readonly thread_id: string;
  readonly query_fingerprint: string;
  readonly mode: CareerRetrievalMode | null;
  readonly status: "completed" | "failed";
  readonly result_count: number;
  readonly error_code: string | null;
  readonly created_at: string;
}

interface CitationRow {
  readonly chunk_id: string;
  readonly source_id: string;
  readonly claim_id: string;
  readonly score: number;
}

export class SqliteCareerRetrievalAuditStore
  implements CareerRetrievalAuditStore
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
    input: RecordCareerRetrievalAccessInput,
  ): CareerRetrievalAccessRecord {
    assertAccessInput(input);
    const id = randomUUID();
    const createdAt = this.now().toISOString();
    return this.database.transaction(() => {
      this.database.prepare(
        `INSERT INTO career_retrieval_accesses
          (id, event_id, actor_id, workspace_id, corpus_actor_id,
           corpus_workspace_id, channel_kind, channel_id, thread_id,
           query_fingerprint, mode, status, result_count, error_code, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        input.eventId,
        input.actorId,
        input.workspaceId,
        input.corpusActorId,
        input.corpusWorkspaceId,
        input.channelKind,
        input.channelId,
        input.threadId,
        input.queryFingerprint,
        input.mode,
        input.status,
        input.resultCount,
        input.errorCode,
        createdAt,
      );
      const insertCitation = this.database.prepare(
        `INSERT INTO career_retrieval_access_citations
          (access_id, ordinal, chunk_id, source_id, claim_id, score)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      input.citations.forEach((citation, ordinal) => {
        insertCitation.run(
          id,
          ordinal,
          citation.chunkId,
          citation.sourceId,
          citation.claimId,
          citation.score,
        );
      });
      return this.requireAccess(id);
    })();
  }

  listAccesses(
    scope: CareerEvidenceScope,
    limit: number,
  ): readonly CareerRetrievalAccessRecord[] {
    const boundedLimit = Math.max(1, Math.min(limit, 200));
    const rows = this.database.prepare(
      `SELECT * FROM career_retrieval_accesses
       WHERE corpus_actor_id = ? AND corpus_workspace_id = ?
       ORDER BY created_at DESC, id DESC LIMIT ?`,
    ).all(scope.actorId, scope.workspaceId, boundedLimit) as AccessRow[];
    return rows.map((row) => this.mapAccess(row));
  }

  close(): void {
    this.database.close();
  }

  private requireAccess(id: string): CareerRetrievalAccessRecord {
    const row = this.database.prepare(
      "SELECT * FROM career_retrieval_accesses WHERE id = ?",
    ).get(id) as AccessRow | undefined;
    if (!row) throw new Error("Career retrieval audit record was not committed.");
    return this.mapAccess(row);
  }

  private mapAccess(row: AccessRow): CareerRetrievalAccessRecord {
    const citations = this.database.prepare(
      `SELECT chunk_id, source_id, claim_id, score
       FROM career_retrieval_access_citations
       WHERE access_id = ? ORDER BY ordinal ASC`,
    ).all(row.id) as CitationRow[];
    return {
      id: row.id,
      eventId: row.event_id,
      actorId: row.actor_id,
      workspaceId: row.workspace_id,
      corpusActorId: row.corpus_actor_id,
      corpusWorkspaceId: row.corpus_workspace_id,
      channelKind: row.channel_kind,
      channelId: row.channel_id,
      threadId: row.thread_id,
      queryFingerprint: row.query_fingerprint,
      mode: row.mode,
      status: row.status,
      resultCount: row.result_count,
      errorCode: row.error_code,
      citations: citations.map((citation) => ({
        chunkId: citation.chunk_id,
        sourceId: citation.source_id,
        claimId: citation.claim_id,
        score: citation.score,
      })),
      createdAt: row.created_at,
    };
  }

  private migrate(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS career_retrieval_accesses (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        corpus_actor_id TEXT NOT NULL,
        corpus_workspace_id TEXT NOT NULL,
        channel_kind TEXT NOT NULL CHECK(channel_kind IN (
          'cli', 'private_chat', 'slack_dm', 'slack_private', 'slack_shared'
        )),
        channel_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        query_fingerprint TEXT NOT NULL,
        mode TEXT CHECK(mode IN ('hybrid', 'lexical_fallback')),
        status TEXT NOT NULL CHECK(status IN ('completed', 'failed')),
        result_count INTEGER NOT NULL CHECK(result_count >= 0),
        error_code TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS career_retrieval_accesses_scope
        ON career_retrieval_accesses(
          corpus_actor_id, corpus_workspace_id, created_at DESC
        );
      CREATE TABLE IF NOT EXISTS career_retrieval_access_citations (
        access_id TEXT NOT NULL REFERENCES career_retrieval_accesses(id) ON DELETE CASCADE,
        ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
        chunk_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        claim_id TEXT NOT NULL,
        score REAL NOT NULL,
        PRIMARY KEY (access_id, ordinal)
      );
    `);
  }
}

function assertAccessInput(input: RecordCareerRetrievalAccessInput): void {
  if (!/^[a-f0-9]{64}$/.test(input.queryFingerprint)) {
    throw new RangeError("Career retrieval query fingerprint must be a SHA-256 digest.");
  }
  if (input.resultCount !== input.citations.length) {
    throw new RangeError("Career retrieval result count must match retained citations.");
  }
  if (
    input.status === "completed" &&
    (input.errorCode !== null || input.mode === null)
  ) {
    throw new RangeError("Completed career retrieval requires a mode and no error.");
  }
  if (
    input.status === "failed" &&
    (input.resultCount !== 0 || input.errorCode === null || input.mode !== null)
  ) {
    throw new RangeError("Failed career retrieval requires an error and no results or mode.");
  }
}
