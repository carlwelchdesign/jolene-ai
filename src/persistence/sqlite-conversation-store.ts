import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import type {
  CompletedExchange,
  ConversationAddress,
  ConversationStore,
  ConversationTurn,
  EventClaim,
  TurnRole,
} from "../domain/conversation.js";

interface ConversationRow {
  readonly id: string;
}

interface EventRow {
  readonly status: "processing" | "completed" | "retryable";
  readonly response: string | null;
}

interface TurnRow {
  readonly public_id: string;
  readonly role: TurnRole;
  readonly content: string;
  readonly created_at: string;
}

export class SqliteConversationStore implements ConversationStore {
  private readonly database: Database.Database;

  constructor(databasePath: string) {
    if (databasePath !== ":memory:") {
      fs.mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });
    }

    this.database = new Database(databasePath);
    this.database.pragma("journal_mode = WAL");
    this.database.pragma("foreign_keys = ON");
    this.migrate();
  }

  claimEvent(
    address: ConversationAddress,
    eventId: string,
    message: string,
  ): EventClaim {
    const claim = this.database.transaction((): EventClaim => {
      const conversationId = this.ensureConversation(address);
      const eventKey = scopedEventKey(address, eventId);
      const existing = this.database
        .prepare("SELECT status, response FROM inbound_events WHERE event_id = ?")
        .get(eventKey) as EventRow | undefined;

      if (existing?.status === "completed") {
        return {
          kind: "duplicate",
          status: "completed",
          response: existing.response,
        };
      }

      if (existing?.status === "processing") {
        return { kind: "duplicate", status: "processing", response: null };
      }

      const now = new Date().toISOString();
      if (existing?.status === "retryable") {
        this.database
          .prepare(
            `UPDATE inbound_events
             SET status = 'processing', error_code = NULL, updated_at = ?
             WHERE event_id = ?`,
          )
          .run(now, eventKey);
      } else {
        this.database
          .prepare(
            `INSERT INTO inbound_events
              (event_id, conversation_id, message, status, created_at, updated_at)
             VALUES (?, ?, ?, 'processing', ?, ?)`,
          )
          .run(eventKey, conversationId, message, now, now);
      }

      return { kind: "claimed", eventKey };
    });

    return claim();
  }

  completeEvent(eventKey: string, exchange: CompletedExchange): void {
    const complete = this.database.transaction(() => {
      const event = this.database
        .prepare(
          "SELECT conversation_id FROM inbound_events WHERE event_id = ? AND status = 'processing'",
        )
        .get(eventKey) as { conversation_id: string } | undefined;

      if (!event) {
        throw new Error("The inbound event is not in processing state.");
      }

      const now = new Date().toISOString();
      const insertTurn = this.database.prepare(
        `INSERT INTO turns (public_id, conversation_id, role, content, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      );

      insertTurn.run(
        randomUUID(),
        event.conversation_id,
        "user",
        exchange.userMessage,
        now,
      );
      insertTurn.run(
        randomUUID(),
        event.conversation_id,
        "assistant",
        exchange.assistantMessage,
        now,
      );

      this.database
        .prepare(
          `UPDATE inbound_events
           SET status = 'completed', response = ?, updated_at = ?
           WHERE event_id = ?`,
        )
        .run(exchange.assistantMessage, now, eventKey);
    });

    complete();
  }

  failEvent(eventKey: string, errorCode: string): void {
    this.database
      .prepare(
        `UPDATE inbound_events
         SET status = 'retryable', error_code = ?, updated_at = ?
         WHERE event_id = ? AND status = 'processing'`,
      )
      .run(errorCode.slice(0, 120), new Date().toISOString(), eventKey);
  }

  recentTurns(
    address: ConversationAddress,
    limit: number,
  ): ConversationTurn[] {
    const conversation = this.findConversation(address);
    if (!conversation) {
      return [];
    }

    const rows = this.database
      .prepare(
        `SELECT public_id, role, content, created_at
         FROM turns
         WHERE conversation_id = ?
         ORDER BY sequence_id DESC
         LIMIT ?`,
      )
      .all(conversation.id, Math.max(1, limit)) as TurnRow[];

    return rows.reverse().map((row) => ({
      id: row.public_id,
      role: row.role,
      content: row.content,
      createdAt: row.created_at,
    }));
  }

  close(): void {
    this.database.close();
  }

  private ensureConversation(address: ConversationAddress): string {
    const existing = this.findConversation(address);
    if (existing) {
      return existing.id;
    }

    const id = randomUUID();
    this.database
      .prepare(
        `INSERT INTO conversations
          (id, actor_id, workspace_id, channel_kind, channel_id, thread_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(actor_id, workspace_id, channel_kind, channel_id, thread_id)
         DO NOTHING`,
      )
      .run(
        id,
        address.actorId,
        address.workspaceId,
        address.channelKind,
        address.channelId,
        address.threadId,
        new Date().toISOString(),
      );

    return this.findConversation(address)?.id ?? id;
  }

  private findConversation(
    address: ConversationAddress,
  ): ConversationRow | undefined {
    return this.database
      .prepare(
        `SELECT id FROM conversations
         WHERE actor_id = ? AND workspace_id = ? AND channel_kind = ?
           AND channel_id = ? AND thread_id = ?`,
      )
      .get(
        address.actorId,
        address.workspaceId,
        address.channelKind,
        address.channelId,
        address.threadId,
      ) as ConversationRow | undefined;
  }

  private migrate(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        actor_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        channel_kind TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(actor_id, workspace_id, channel_kind, channel_id, thread_id)
      );

      CREATE TABLE IF NOT EXISTS inbound_events (
        event_id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        message TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('processing', 'completed', 'retryable')),
        response TEXT,
        error_code TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS turns (
        sequence_id INTEGER PRIMARY KEY AUTOINCREMENT,
        public_id TEXT NOT NULL UNIQUE,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS turns_conversation_sequence
        ON turns(conversation_id, sequence_id DESC);
    `);
  }
}

function scopedEventKey(
  address: ConversationAddress,
  eventId: string,
): string {
  return JSON.stringify([
    address.actorId,
    address.workspaceId,
    address.channelKind,
    address.channelId,
    address.threadId,
    eventId,
  ]);
}
