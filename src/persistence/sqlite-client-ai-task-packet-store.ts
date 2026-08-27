import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import {
  ClientAiPacketConflictError,
  ClientAiPacketExpiredError,
  ClientAiPacketNotFoundError,
  ClientAiPacketPayloadMismatchError,
  fingerprintClientAiTaskPacket,
  fingerprintClientAiTurn,
  requireClientAiRecipient,
  type ClientAiContextItem,
  type ClientAiHandoff,
  type ClientAiPacketStatus,
  type ClientAiRecipientId,
  type ClientAiTaskPacket,
  type ClientAiTaskPacketStore,
  type ClientAiTranscriptSpeaker,
  type ClientAiTranscriptTurn,
  type CreateClientAiTaskPacketInput,
  type DecideClientAiTaskPacketInput,
  type RecordClientAiTurnInput,
  type ReviewClientAiHandoffInput,
  type SubmitClientAiHandoffInput,
} from "../domain/client-ai-task-packet.js";
import type { PrivateWorkScope } from "../domain/private-work-scope.js";

interface PacketRow {
  readonly id: string;
  readonly actor_id: string;
  readonly workspace_id: string;
  readonly task_id: string;
  readonly recipient_id: ClientAiRecipientId;
  readonly purpose: string;
  readonly context_json: string;
  readonly questions_json: string;
  readonly turn_limit: number;
  readonly expires_at: string;
  readonly payload_fingerprint: string;
  readonly status: ClientAiPacketStatus;
  readonly turns_used: number;
  readonly next_speaker: ClientAiTranscriptSpeaker | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly decided_at: string | null;
  readonly cancelled_at: string | null;
  readonly closed_at: string | null;
}

interface TurnRow {
  readonly id: string;
  readonly packet_id: string;
  readonly sequence: number;
  readonly speaker: ClientAiTranscriptSpeaker;
  readonly sender_identity: string;
  readonly content: string;
  readonly content_fingerprint: string;
  readonly request_id: string;
  readonly created_at: string;
}

interface HandoffRow {
  readonly id: string;
  readonly packet_id: string;
  readonly version: number;
  readonly summary: string;
  readonly decisions_json: string;
  readonly unresolved_questions_json: string;
  readonly proposed_next_action: string;
  readonly status: ClientAiHandoff["status"];
  readonly submitted_at: string;
  readonly reviewed_at: string | null;
  readonly review_feedback: string | null;
}

export class SqliteClientAiTaskPacketStore implements ClientAiTaskPacketStore {
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

  create(input: CreateClientAiTaskPacketInput, now: Date): ClientAiTaskPacket {
    const id = randomUUID();
    const createdAt = now.toISOString();
    this.database.prepare(
      `INSERT INTO client_ai_task_packets
       (id, actor_id, workspace_id, task_id, recipient_id, purpose, context_json,
        questions_json, turn_limit, expires_at, payload_fingerprint, status,
        turns_used, next_speaker, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 0, 'jolene', ?, ?)`,
    ).run(
      id,
      input.actorId,
      input.workspaceId,
      input.taskId,
      input.recipientId,
      input.purpose,
      JSON.stringify(input.contextItems),
      JSON.stringify(input.questions),
      input.turnLimit,
      input.expiresAt,
      fingerprintClientAiTaskPacket(input),
      createdAt,
      createdAt,
    );
    return this.get(id, input, new Date(createdAt));
  }

  get(id: string, scope: PrivateWorkScope, now: Date): ClientAiTaskPacket {
    this.expireDue(scope, now);
    return this.requirePacket(id, scope);
  }

  list(
    scope: PrivateWorkScope,
    now: Date,
    limit: number,
  ): readonly ClientAiTaskPacket[] {
    this.expireDue(scope, now);
    const rows = this.database.prepare(
      `SELECT * FROM client_ai_task_packets WHERE actor_id = ? AND workspace_id = ?
       ORDER BY created_at DESC, id DESC LIMIT ?`,
    ).all(scope.actorId, scope.workspaceId, limit) as PacketRow[];
    return rows.map((row) => this.mapPacket(row));
  }

  decide(input: DecideClientAiTaskPacketInput, now: Date): ClientAiTaskPacket {
    return this.database.transaction(() => {
      this.expireDue(input, now);
      const packet = this.requirePacket(input.id, input);
      if (packet.status === "expired") throw new ClientAiPacketExpiredError();
      if (packet.payloadFingerprint !== input.expectedFingerprint) {
        throw new ClientAiPacketPayloadMismatchError();
      }
      if (packet.status === input.decision) return packet;
      if (packet.status !== "draft") throw new ClientAiPacketConflictError();
      const changed = this.database.prepare(
        `UPDATE client_ai_task_packets SET status = ?, decided_at = ?, updated_at = ?
         WHERE id = ? AND status = 'draft'`,
      ).run(input.decision, now.toISOString(), now.toISOString(), input.id);
      if (changed.changes !== 1) throw new ClientAiPacketConflictError();
      return this.requirePacket(input.id, input);
    }).immediate();
  }

  cancel(id: string, scope: PrivateWorkScope, now: Date): ClientAiTaskPacket {
    return this.database.transaction(() => {
      this.expireDue(scope, now);
      const packet = this.requirePacket(id, scope);
      if (packet.status === "cancelled") return packet;
      if (!["draft", "approved", "active", "handoff_required"].includes(packet.status)) {
        throw new ClientAiPacketConflictError();
      }
      this.database.prepare(
        `UPDATE client_ai_task_packets SET status = 'cancelled', next_speaker = NULL,
         cancelled_at = ?, updated_at = ? WHERE id = ?`,
      ).run(now.toISOString(), now.toISOString(), id);
      return this.requirePacket(id, scope);
    }).immediate();
  }

  recordTurn(input: RecordClientAiTurnInput, now: Date): ClientAiTaskPacket {
    return this.database.transaction(() => {
      const existing = this.findTurn(input.id, input.requestId);
      if (existing) {
        if (
          existing.speaker !== input.speaker ||
          existing.senderIdentity !== input.senderIdentity ||
          existing.contentFingerprint !== fingerprintClientAiTurn(input.content)
        ) {
          throw new ClientAiPacketPayloadMismatchError(
            "The client-AI turn request ID was already used for different content.",
          );
        }
        return this.requirePacket(input.id, input);
      }
      this.expireDue(input, now);
      const row = this.requirePacketRow(input.id, input);
      if (row.status === "expired") throw new ClientAiPacketExpiredError();
      if (row.status !== "approved" && row.status !== "active") {
        throw new ClientAiPacketConflictError();
      }
      if (row.next_speaker !== input.speaker) {
        throw new ClientAiPacketConflictError("Client-AI transcript speakers must alternate.");
      }
      const recipient = requireClientAiRecipient(row.recipient_id);
      const expectedSender = input.speaker === "jolene" ? "jolene" : recipient.senderIdentity;
      if (input.senderIdentity !== expectedSender) {
        throw new ClientAiPacketPayloadMismatchError(
          "The transcript sender does not match the approved packet identity.",
        );
      }
      if (input.speaker === "jolene" && row.turns_used >= row.turn_limit) {
        throw new ClientAiPacketConflictError("The approved client-AI turn limit is exhausted.");
      }
      const previous = this.database.prepare(
        "SELECT MAX(sequence) AS sequence FROM client_ai_transcript_turns WHERE packet_id = ?",
      ).get(input.id) as { sequence: number | null };
      const sequence = (previous.sequence ?? 0) + 1;
      this.database.prepare(
        `INSERT INTO client_ai_transcript_turns
         (id, packet_id, sequence, speaker, sender_identity, content,
          content_fingerprint, request_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        randomUUID(),
        input.id,
        sequence,
        input.speaker,
        input.senderIdentity,
        input.content,
        fingerprintClientAiTurn(input.content),
        input.requestId,
        now.toISOString(),
      );
      const turnsUsed = row.turns_used + (input.speaker === "jolene" ? 1 : 0);
      const limitReached = input.speaker === "external_ai" && turnsUsed >= row.turn_limit;
      this.database.prepare(
        `UPDATE client_ai_task_packets SET status = ?, turns_used = ?, next_speaker = ?,
         updated_at = ? WHERE id = ?`,
      ).run(
        limitReached ? "handoff_required" : "active",
        turnsUsed,
        limitReached ? null : input.speaker === "jolene" ? "external_ai" : "jolene",
        now.toISOString(),
        input.id,
      );
      return this.requirePacket(input.id, input);
    }).immediate();
  }

  submitHandoff(
    input: SubmitClientAiHandoffInput,
    now: Date,
  ): ClientAiTaskPacket {
    return this.database.transaction(() => {
      this.expireDue(input, now);
      const packet = this.requirePacket(input.id, input);
      if (packet.status !== "active" && packet.status !== "handoff_required") {
        throw new ClientAiPacketConflictError();
      }
      const lastTurn = packet.transcript.at(-1);
      if (!lastTurn || lastTurn.speaker !== "external_ai") {
        throw new ClientAiPacketConflictError(
          "A handoff can be prepared only after an external-AI response.",
        );
      }
      const latest = packet.handoffs.at(-1);
      if (latest?.status === "pending_review") {
        throw new ClientAiPacketConflictError("The latest handoff is already awaiting review.");
      }
      const version = (latest?.version ?? 0) + 1;
      this.database.prepare(
        `INSERT INTO client_ai_handoffs
         (id, packet_id, version, summary, decisions_json,
          unresolved_questions_json, proposed_next_action, status, submitted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending_review', ?)`,
      ).run(
        randomUUID(),
        input.id,
        version,
        input.summary,
        JSON.stringify(input.decisions),
        JSON.stringify(input.unresolvedQuestions),
        input.proposedNextAction,
        now.toISOString(),
      );
      this.database.prepare(
        `UPDATE client_ai_task_packets SET status = 'handoff_required',
         next_speaker = NULL, updated_at = ? WHERE id = ?`,
      ).run(now.toISOString(), input.id);
      return this.requirePacket(input.id, input);
    }).immediate();
  }

  reviewHandoff(
    input: ReviewClientAiHandoffInput,
    now: Date,
  ): ClientAiTaskPacket {
    return this.database.transaction(() => {
      const packet = this.requirePacket(input.id, input);
      const handoff = packet.handoffs.find((candidate) => candidate.id === input.handoffId);
      if (!handoff || handoff.version !== packet.handoffs.at(-1)?.version) {
        throw new ClientAiPacketConflictError("Only the latest handoff can be reviewed.");
      }
      const nextStatus = input.decision === "approved" ? "approved" : "changes_requested";
      if (handoff.status === nextStatus) return packet;
      if (handoff.status !== "pending_review" || packet.status !== "handoff_required") {
        throw new ClientAiPacketConflictError();
      }
      this.database.prepare(
        `UPDATE client_ai_handoffs SET status = ?, reviewed_at = ?, review_feedback = ?
         WHERE id = ? AND status = 'pending_review'`,
      ).run(nextStatus, now.toISOString(), input.feedback || null, input.handoffId);
      if (input.decision === "approved") {
        this.database.prepare(
          `UPDATE client_ai_task_packets SET status = 'closed', closed_at = ?,
           updated_at = ? WHERE id = ? AND status = 'handoff_required'`,
        ).run(now.toISOString(), now.toISOString(), input.id);
      } else {
        this.database.prepare(
          `UPDATE client_ai_task_packets SET updated_at = ?
           WHERE id = ? AND status = 'handoff_required'`,
        ).run(now.toISOString(), input.id);
      }
      return this.requirePacket(input.id, input);
    }).immediate();
  }

  close(): void { this.database.close(); }

  private expireDue(scope: PrivateWorkScope, now: Date): void {
    this.database.prepare(
      `UPDATE client_ai_task_packets SET status = 'expired', next_speaker = NULL,
       updated_at = ? WHERE actor_id = ? AND workspace_id = ?
       AND status IN ('draft', 'approved', 'active') AND expires_at <= ?`,
    ).run(now.toISOString(), scope.actorId, scope.workspaceId, now.toISOString());
  }

  private requirePacket(id: string, scope: PrivateWorkScope): ClientAiTaskPacket {
    return this.mapPacket(this.requirePacketRow(id, scope));
  }

  private requirePacketRow(id: string, scope: PrivateWorkScope): PacketRow {
    const row = this.database.prepare(
      `SELECT * FROM client_ai_task_packets
       WHERE id = ? AND actor_id = ? AND workspace_id = ?`,
    ).get(id, scope.actorId, scope.workspaceId) as PacketRow | undefined;
    if (!row) throw new ClientAiPacketNotFoundError();
    return row;
  }

  private mapPacket(row: PacketRow): ClientAiTaskPacket {
    const transcript = this.database.prepare(
      `SELECT * FROM client_ai_transcript_turns WHERE packet_id = ? ORDER BY sequence ASC`,
    ).all(row.id) as TurnRow[];
    const handoffs = this.database.prepare(
      `SELECT * FROM client_ai_handoffs WHERE packet_id = ? ORDER BY version ASC`,
    ).all(row.id) as HandoffRow[];
    return {
      id: row.id,
      actorId: row.actor_id,
      workspaceId: row.workspace_id,
      taskId: row.task_id,
      recipientId: row.recipient_id,
      recipient: requireClientAiRecipient(row.recipient_id),
      purpose: row.purpose,
      contextItems: JSON.parse(row.context_json) as ClientAiContextItem[],
      questions: JSON.parse(row.questions_json) as string[],
      turnLimit: row.turn_limit,
      expiresAt: row.expires_at,
      payloadFingerprint: row.payload_fingerprint,
      status: row.status,
      turnsUsed: row.turns_used,
      nextSpeaker: row.next_speaker,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      decidedAt: row.decided_at,
      cancelledAt: row.cancelled_at,
      closedAt: row.closed_at,
      transcript: transcript.map(mapTurn),
      handoffs: handoffs.map(mapHandoff),
    };
  }

  private findTurn(packetId: string, requestId: string): ClientAiTranscriptTurn | null {
    const row = this.database.prepare(
      `SELECT * FROM client_ai_transcript_turns WHERE packet_id = ? AND request_id = ?`,
    ).get(packetId, requestId) as TurnRow | undefined;
    return row ? mapTurn(row) : null;
  }

  private migrate(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS client_ai_task_packets (
        id TEXT PRIMARY KEY,
        actor_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        recipient_id TEXT NOT NULL CHECK(recipient_id IN ('jenny', 'maria')),
        purpose TEXT NOT NULL,
        context_json TEXT NOT NULL,
        questions_json TEXT NOT NULL,
        turn_limit INTEGER NOT NULL CHECK(turn_limit BETWEEN 1 AND 5),
        expires_at TEXT NOT NULL,
        payload_fingerprint TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN (
          'draft', 'approved', 'rejected', 'active', 'handoff_required',
          'closed', 'cancelled', 'expired'
        )),
        turns_used INTEGER NOT NULL,
        next_speaker TEXT CHECK(next_speaker IN ('jolene', 'external_ai')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        decided_at TEXT,
        cancelled_at TEXT,
        closed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_client_ai_packets_scope_status
      ON client_ai_task_packets(actor_id, workspace_id, status, created_at DESC);

      CREATE TABLE IF NOT EXISTS client_ai_transcript_turns (
        id TEXT PRIMARY KEY,
        packet_id TEXT NOT NULL REFERENCES client_ai_task_packets(id) ON DELETE RESTRICT,
        sequence INTEGER NOT NULL,
        speaker TEXT NOT NULL CHECK(speaker IN ('jolene', 'external_ai')),
        sender_identity TEXT NOT NULL,
        content TEXT NOT NULL,
        content_fingerprint TEXT NOT NULL,
        request_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(packet_id, sequence),
        UNIQUE(packet_id, request_id)
      );

      CREATE TABLE IF NOT EXISTS client_ai_handoffs (
        id TEXT PRIMARY KEY,
        packet_id TEXT NOT NULL REFERENCES client_ai_task_packets(id) ON DELETE RESTRICT,
        version INTEGER NOT NULL,
        summary TEXT NOT NULL,
        decisions_json TEXT NOT NULL,
        unresolved_questions_json TEXT NOT NULL,
        proposed_next_action TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN (
          'pending_review', 'changes_requested', 'approved'
        )),
        submitted_at TEXT NOT NULL,
        reviewed_at TEXT,
        review_feedback TEXT,
        UNIQUE(packet_id, version)
      );
    `);
  }
}

function mapTurn(row: TurnRow): ClientAiTranscriptTurn {
  return {
    id: row.id,
    packetId: row.packet_id,
    sequence: row.sequence,
    speaker: row.speaker,
    senderIdentity: row.sender_identity,
    content: row.content,
    contentFingerprint: row.content_fingerprint,
    requestId: row.request_id,
    createdAt: row.created_at,
  };
}

function mapHandoff(row: HandoffRow): ClientAiHandoff {
  return {
    id: row.id,
    packetId: row.packet_id,
    version: row.version,
    summary: row.summary,
    decisions: JSON.parse(row.decisions_json) as string[],
    unresolvedQuestions: JSON.parse(row.unresolved_questions_json) as string[],
    proposedNextAction: row.proposed_next_action,
    status: row.status,
    submittedAt: row.submitted_at,
    reviewedAt: row.reviewed_at,
    reviewFeedback: row.review_feedback,
  };
}
