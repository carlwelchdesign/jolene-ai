import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import {
  MemoryProposalConflictError,
  MemoryProposalNotFoundError,
  WorkTaskNotFoundError,
  type AuthorizedWorkContext,
  type CreateTaskInput,
  type DecideMemoryInput,
  type DurableMemory,
  type MemoryKind,
  type MemoryProposal,
  type ProposeMemoryInput,
  type TaskStatus,
  type UpdateTaskStatusInput,
  type WorkContextStore,
  type WorkTask,
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
  readonly source_proposal_id: string;
  readonly created_at: string;
}

export class SqliteWorkContextStore implements WorkContextStore {
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

  createTask(input: CreateTaskInput): WorkTask {
    const id = randomUUID();
    const now = new Date().toISOString();
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
        new Date().toISOString(),
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
    if (input.taskId) {
      this.requireTask(input.taskId, input.actorId, input.workspaceId);
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO memory_proposals
          (id, actor_id, workspace_id, task_id, kind, content, source,
           status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      )
      .run(
        id,
        input.actorId,
        input.workspaceId,
        input.taskId,
        input.kind,
        input.content,
        input.source,
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

      const now = new Date().toISOString();
      this.database
        .prepare(
          `UPDATE memory_proposals
           SET status = ?, decided_at = ?
           WHERE id = ? AND status = 'pending'`,
        )
        .run(input.decision, now, input.id);

      if (input.decision === "approved") {
        this.database
          .prepare(
            `INSERT INTO durable_memories
              (id, actor_id, workspace_id, task_id, kind, content,
               source_proposal_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            randomUUID(),
            proposal.actorId,
            proposal.workspaceId,
            proposal.taskId,
            proposal.kind,
            proposal.content,
            proposal.id,
            now,
          );
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

  loadAuthorizedContext(
    actorId: string,
    workspaceId: string,
    taskId: string | undefined,
    memoryLimit: number,
  ): AuthorizedWorkContext {
    const task = taskId
      ? this.requireTask(taskId, actorId, workspaceId)
      : null;
    const rows = taskId
      ? (this.database
          .prepare(
            `SELECT * FROM durable_memories
             WHERE actor_id = ? AND workspace_id = ?
               AND (task_id IS NULL OR task_id = ?)
             ORDER BY created_at DESC
             LIMIT ?`,
          )
          .all(actorId, workspaceId, taskId, Math.max(1, memoryLimit)) as MemoryRow[])
      : (this.database
          .prepare(
            `SELECT * FROM durable_memories
             WHERE actor_id = ? AND workspace_id = ? AND task_id IS NULL
             ORDER BY created_at DESC
             LIMIT ?`,
          )
          .all(actorId, workspaceId, Math.max(1, memoryLimit)) as MemoryRow[]);

    return { task, memories: rows.reverse().map(mapMemory) };
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
        source_proposal_id TEXT NOT NULL UNIQUE
          REFERENCES memory_proposals(id) ON DELETE RESTRICT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS durable_memories_scope_task
        ON durable_memories(actor_id, workspace_id, task_id, created_at DESC);
    `);
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
    status: row.status,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
  };
}

function mapMemory(row: MemoryRow): DurableMemory {
  return {
    id: row.id,
    actorId: row.actor_id,
    workspaceId: row.workspace_id,
    taskId: row.task_id,
    kind: row.kind,
    content: row.content,
    sourceProposalId: row.source_proposal_id,
    createdAt: row.created_at,
  };
}
