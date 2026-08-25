import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import { rankMemories } from "../domain/memory-ranking.js";
import {
  DurableMemoryConflictError,
  DurableMemoryNotFoundError,
  MemoryProposalConflictError,
  MemoryProposalNotFoundError,
  WorkTaskNotFoundError,
  type AuthorizedWorkContext,
  type CreateTaskInput,
  type DecideMemoryInput,
  type DurableMemory,
  type ForgetMemoryInput,
  type MemoryKind,
  type MemoryProposal,
  type MemorySensitivity,
  type ProposeMemoryInput,
  type TaskStatus,
  type UpdateTaskStatusInput,
  type WorkContextStore,
  type WorkTask,
  type AuthorizedContextRequest,
} from "../domain/work-context.js";

interface TaskRow {
  readonly id: string;
  readonly actor_id: string;
  readonly workspace_id: string;
  readonly title: string;
  readonly objective: string;
  readonly status: TaskStatus;
  readonly created_at: string;
  readonly updated_at: string;
}

interface ProposalRow {
  readonly id: string;
  readonly actor_id: string;
  readonly workspace_id: string;
  readonly task_id: string | null;
  readonly kind: MemoryKind;
  readonly content: string;
  readonly source: string;
  readonly sensitivity: MemorySensitivity;
  readonly expires_at: string | null;
  readonly replaces_memory_id: string | null;
  readonly status: MemoryProposal["status"];
  readonly created_at: string;
  readonly decided_at: string | null;
}

interface MemoryRow {
  readonly id: string;
  readonly actor_id: string;
  readonly workspace_id: string;
  readonly task_id: string | null;
  readonly kind: MemoryKind;
  readonly content: string;
  readonly sensitivity: MemorySensitivity;
  readonly expires_at: string | null;
  readonly source_proposal_id: string;
  readonly created_at: string;
  readonly retired_at: string | null;
  readonly retirement_reason: "superseded" | "forgotten" | null;
}

export class SqliteWorkContextStore implements WorkContextStore {
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

  createTask(input: CreateTaskInput): WorkTask {
    const id = randomUUID();
    const now = this.now().toISOString();
    this.database
      .prepare(
        `INSERT INTO work_tasks
          (id, actor_id, workspace_id, title, objective, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
      )
      .run(
        id,
        input.actorId,
        input.workspaceId,
        input.title,
        input.objective,
        now,
        now,
      );

    return this.requireTask(id, input.actorId, input.workspaceId);
  }

  updateTaskStatus(input: UpdateTaskStatusInput): WorkTask {
    const result = this.database
      .prepare(
        `UPDATE work_tasks
         SET status = ?, updated_at = ?
         WHERE id = ? AND actor_id = ? AND workspace_id = ?`,
      )
      .run(
        input.status,
        this.now().toISOString(),
        input.id,
        input.actorId,
        input.workspaceId,
      );

    if (result.changes !== 1) throw new WorkTaskNotFoundError();
    return this.requireTask(input.id, input.actorId, input.workspaceId);
  }

  listTasks(
    actorId: string,
    workspaceId: string,
    status: TaskStatus | undefined,
  ): readonly WorkTask[] {
    const rows = status
      ? (this.database
          .prepare(
            `SELECT * FROM work_tasks
             WHERE actor_id = ? AND workspace_id = ? AND status = ?
             ORDER BY updated_at DESC`,
          )
          .all(actorId, workspaceId, status) as TaskRow[])
      : (this.database
          .prepare(
            `SELECT * FROM work_tasks
             WHERE actor_id = ? AND workspace_id = ?
             ORDER BY updated_at DESC`,
          )
          .all(actorId, workspaceId) as TaskRow[]);

    return rows.map(mapTask);
  }

  proposeMemory(input: ProposeMemoryInput): MemoryProposal {
    const sensitivity = input.sensitivity ?? "private";
    const expiresAt = input.expiresAt
      ? new Date(input.expiresAt).toISOString()
      : null;
    const replacesMemoryId = input.replacesMemoryId ?? null;
    if (sensitivity !== "private" && !input.taskId) {
      throw new DurableMemoryConflictError();
    }
    if (input.taskId) {
      this.requireTask(input.taskId, input.actorId, input.workspaceId);
    }
    if (replacesMemoryId) {
      const replaced = this.requireActiveMemory(
        replacesMemoryId,
        input.actorId,
        input.workspaceId,
      );
      if (replaced.taskId !== input.taskId) {
        throw new DurableMemoryConflictError();
      }
    }

    const id = randomUUID();
    const now = this.now().toISOString();
    this.database
      .prepare(
        `INSERT INTO memory_proposals
          (id, actor_id, workspace_id, task_id, kind, content, source,
           sensitivity, expires_at, replaces_memory_id, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      )
      .run(
        id,
        input.actorId,
        input.workspaceId,
        input.taskId,
        input.kind,
        input.content,
        input.source,
        sensitivity,
        expiresAt,
        replacesMemoryId,
        now,
      );

    return this.requireProposal(id, input.actorId, input.workspaceId);
  }

  decideMemory(input: DecideMemoryInput): MemoryProposal {
    const decide = this.database.transaction((): MemoryProposal => {
      const proposal = this.requireProposal(
        input.id,
        input.actorId,
        input.workspaceId,
      );

      if (proposal.status !== "pending") {
        if (proposal.status === input.decision) return proposal;
        throw new MemoryProposalConflictError();
      }

      const now = this.now().toISOString();
      this.database
        .prepare(
          `UPDATE memory_proposals
           SET status = ?, decided_at = ?
           WHERE id = ? AND status = 'pending'`,
        )
        .run(input.decision, now, input.id);

      if (input.decision === "approved") {
        if (proposal.replacesMemoryId) {
          this.requireActiveMemory(
            proposal.replacesMemoryId,
            proposal.actorId,
            proposal.workspaceId,
          );
        }
        this.database
          .prepare(
            `INSERT INTO durable_memories
              (id, actor_id, workspace_id, task_id, kind, content,
               sensitivity, expires_at, source_proposal_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            randomUUID(),
            proposal.actorId,
            proposal.workspaceId,
            proposal.taskId,
            proposal.kind,
            proposal.content,
            proposal.sensitivity,
            proposal.expiresAt,
            proposal.id,
            now,
          );
        if (proposal.replacesMemoryId) {
          this.database
            .prepare(
              `UPDATE durable_memories
               SET retired_at = ?, retirement_reason = 'superseded'
               WHERE id = ? AND retired_at IS NULL`,
            )
            .run(now, proposal.replacesMemoryId);
        }
      }

      return this.requireProposal(input.id, input.actorId, input.workspaceId);
    });

    return decide();
  }

  listMemoryProposals(
    actorId: string,
    workspaceId: string,
    status: MemoryProposal["status"] | undefined,
  ): readonly MemoryProposal[] {
    const rows = status
      ? (this.database
          .prepare(
            `SELECT * FROM memory_proposals
             WHERE actor_id = ? AND workspace_id = ? AND status = ?
             ORDER BY created_at DESC`,
          )
          .all(actorId, workspaceId, status) as ProposalRow[])
      : (this.database
          .prepare(
            `SELECT * FROM memory_proposals
             WHERE actor_id = ? AND workspace_id = ?
             ORDER BY created_at DESC`,
          )
          .all(actorId, workspaceId) as ProposalRow[]);

    return rows.map(mapProposal);
  }

  listMemories(actorId: string, workspaceId: string): readonly DurableMemory[] {
    const rows = this.database
      .prepare(
        `SELECT * FROM durable_memories
         WHERE actor_id = ? AND workspace_id = ?
         ORDER BY created_at DESC`,
      )
      .all(actorId, workspaceId) as MemoryRow[];

    const now = this.now();
    return rows.map((row) => mapMemory(row, now));
  }

  forgetMemory(input: ForgetMemoryInput): DurableMemory {
    const forget = this.database.transaction((): DurableMemory => {
      const memory = this.requireMemory(
        input.id,
        input.actorId,
        input.workspaceId,
      );
      if (memory.state === "forgotten") return memory;

      const now = this.now().toISOString();
      this.database
        .prepare(
          `UPDATE durable_memories
           SET content = '[forgotten]', expires_at = NULL, retired_at = ?,
               retirement_reason = 'forgotten'
           WHERE id = ?`,
        )
        .run(now, input.id);
      this.database
        .prepare(
          `UPDATE memory_proposals
           SET content = '[forgotten]', source = '[redacted by forget request]'
           WHERE id = ?`,
        )
        .run(memory.sourceProposalId);

      return this.requireMemory(input.id, input.actorId, input.workspaceId);
    });

    return forget();
  }

  loadAuthorizedContext(
    request: AuthorizedContextRequest,
  ): AuthorizedWorkContext {
    const task = request.taskId
      ? this.requireTask(request.taskId, request.actorId, request.workspaceId)
      : null;
    const nowDate = this.now();
    const now = nowDate.toISOString();
    const memoryLimit = Math.max(1, request.memoryLimit);
    const candidateLimit = Math.min(500, Math.max(memoryLimit * 8, 64));
    const rows = request.taskId
      ? (this.database
          .prepare(
            `SELECT * FROM durable_memories
             WHERE actor_id = ? AND workspace_id = ?
               AND (task_id IS NULL OR task_id = ?)
               AND retired_at IS NULL
               AND (expires_at IS NULL OR expires_at > ?)
               AND (
                 sensitivity = 'private'
                 OR (task_id = ? AND sensitivity = 'restricted')
                 OR (? = 1 AND task_id = ? AND sensitivity = 'sensitive')
               )
             ORDER BY created_at DESC
             LIMIT ?`,
          )
          .all(
            request.actorId,
            request.workspaceId,
            request.taskId,
            now,
            request.taskId,
            request.includeSensitiveMemory ? 1 : 0,
            request.taskId,
            candidateLimit,
          ) as MemoryRow[])
      : (this.database
          .prepare(
            `SELECT * FROM durable_memories
             WHERE actor_id = ? AND workspace_id = ? AND task_id IS NULL
               AND sensitivity = 'private' AND retired_at IS NULL
               AND (expires_at IS NULL OR expires_at > ?)
             ORDER BY created_at DESC
             LIMIT ?`,
          )
          .all(
            request.actorId,
            request.workspaceId,
            now,
            candidateLimit,
          ) as MemoryRow[]);

    const ranked = rankMemories({
      candidates: rows.map((row) => mapMemory(row, nowDate)),
      query: request.query,
      task,
      limit: memoryLimit,
    });

    return {
      task,
      memories: ranked.memories,
      selection: {
        strategy: "deterministic_lexical_v1",
        candidateCount: ranked.candidateCount,
        queryTerms: ranked.queryTerms,
        evidence: ranked.evidence,
      },
    };
  }

  close(): void {
    this.database.close();
  }

  private requireTask(
    id: string,
    actorId: string,
    workspaceId: string,
  ): WorkTask {
    const row = this.database
      .prepare(
        `SELECT * FROM work_tasks
         WHERE id = ? AND actor_id = ? AND workspace_id = ?`,
      )
      .get(id, actorId, workspaceId) as TaskRow | undefined;

    if (!row) throw new WorkTaskNotFoundError();
    return mapTask(row);
  }

  private requireProposal(
    id: string,
    actorId: string,
    workspaceId: string,
  ): MemoryProposal {
    const row = this.database
      .prepare(
        `SELECT * FROM memory_proposals
         WHERE id = ? AND actor_id = ? AND workspace_id = ?`,
      )
      .get(id, actorId, workspaceId) as ProposalRow | undefined;

    if (!row) throw new MemoryProposalNotFoundError();
    return mapProposal(row);
  }

  private requireMemory(
    id: string,
    actorId: string,
    workspaceId: string,
  ): DurableMemory {
    const row = this.database
      .prepare(
        `SELECT * FROM durable_memories
         WHERE id = ? AND actor_id = ? AND workspace_id = ?`,
      )
      .get(id, actorId, workspaceId) as MemoryRow | undefined;

    if (!row) throw new DurableMemoryNotFoundError();
    return mapMemory(row, this.now());
  }

  private requireActiveMemory(
    id: string,
    actorId: string,
    workspaceId: string,
  ): DurableMemory {
    const memory = this.requireMemory(id, actorId, workspaceId);
    if (memory.state !== "active") throw new DurableMemoryConflictError();
    return memory;
  }

  private migrate(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS work_tasks (
        id TEXT PRIMARY KEY,
        actor_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        title TEXT NOT NULL,
        objective TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN (
          'pending', 'running', 'approval_needed', 'failed', 'retryable',
          'completed', 'cancelled'
        )),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS work_tasks_scope_status
        ON work_tasks(actor_id, workspace_id, status, updated_at DESC);

      CREATE TABLE IF NOT EXISTS memory_proposals (
        id TEXT PRIMARY KEY,
        actor_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        task_id TEXT REFERENCES work_tasks(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK(kind IN (
          'preference', 'project_decision', 'standing_rule', 'corrected_fact'
        )),
        content TEXT NOT NULL,
        source TEXT NOT NULL,
        sensitivity TEXT NOT NULL DEFAULT 'private' CHECK(sensitivity IN (
          'private', 'restricted', 'sensitive'
        )),
        expires_at TEXT,
        replaces_memory_id TEXT REFERENCES durable_memories(id) ON DELETE SET NULL,
        status TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'rejected')),
        created_at TEXT NOT NULL,
        decided_at TEXT
      );

      CREATE INDEX IF NOT EXISTS memory_proposals_scope_status
        ON memory_proposals(actor_id, workspace_id, status, created_at DESC);

      CREATE TABLE IF NOT EXISTS durable_memories (
        id TEXT PRIMARY KEY,
        actor_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        task_id TEXT REFERENCES work_tasks(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK(kind IN (
          'preference', 'project_decision', 'standing_rule', 'corrected_fact'
        )),
        content TEXT NOT NULL,
        sensitivity TEXT NOT NULL DEFAULT 'private' CHECK(sensitivity IN (
          'private', 'restricted', 'sensitive'
        )),
        expires_at TEXT,
        source_proposal_id TEXT NOT NULL UNIQUE
          REFERENCES memory_proposals(id) ON DELETE RESTRICT,
        created_at TEXT NOT NULL,
        retired_at TEXT,
        retirement_reason TEXT CHECK(retirement_reason IN ('superseded', 'forgotten'))
      );
    `);

    this.addColumnIfMissing(
      "memory_proposals",
      "sensitivity",
      "TEXT NOT NULL DEFAULT 'private'",
    );
    this.addColumnIfMissing("memory_proposals", "expires_at", "TEXT");
    this.addColumnIfMissing("memory_proposals", "replaces_memory_id", "TEXT");
    this.addColumnIfMissing(
      "durable_memories",
      "sensitivity",
      "TEXT NOT NULL DEFAULT 'private'",
    );
    this.addColumnIfMissing("durable_memories", "expires_at", "TEXT");
    this.addColumnIfMissing("durable_memories", "retired_at", "TEXT");
    this.addColumnIfMissing("durable_memories", "retirement_reason", "TEXT");

    this.database.exec(`
      CREATE INDEX IF NOT EXISTS durable_memories_scope_task
        ON durable_memories(
          actor_id, workspace_id, task_id, sensitivity, created_at DESC
        );
    `);
  }

  private addColumnIfMissing(
    table: "memory_proposals" | "durable_memories",
    column: string,
    definition: string,
  ): void {
    const columns = this.database.pragma(`table_info(${table})`) as Array<{
      readonly name: string;
    }>;
    if (!columns.some((candidate) => candidate.name === column)) {
      this.database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }
}

function mapTask(row: TaskRow): WorkTask {
  return {
    id: row.id,
    actorId: row.actor_id,
    workspaceId: row.workspace_id,
    title: row.title,
    objective: row.objective,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapProposal(row: ProposalRow): MemoryProposal {
  return {
    id: row.id,
    actorId: row.actor_id,
    workspaceId: row.workspace_id,
    taskId: row.task_id,
    kind: row.kind,
    content: row.content,
    source: row.source,
    sensitivity: row.sensitivity,
    expiresAt: row.expires_at,
    replacesMemoryId: row.replaces_memory_id,
    status: row.status,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
  };
}

function mapMemory(row: MemoryRow, now: Date): DurableMemory {
  const state = row.retirement_reason === "forgotten"
    ? "forgotten"
    : row.retirement_reason === "superseded"
      ? "superseded"
      : row.expires_at && new Date(row.expires_at) <= now
        ? "expired"
        : "active";

  return {
    id: row.id,
    actorId: row.actor_id,
    workspaceId: row.workspace_id,
    taskId: row.task_id,
    kind: row.kind,
    content: row.content,
    sensitivity: row.sensitivity,
    expiresAt: row.expires_at,
    sourceProposalId: row.source_proposal_id,
    createdAt: row.created_at,
    state,
    retiredAt: row.retired_at,
  };
}
