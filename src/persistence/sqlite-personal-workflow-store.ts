import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import {
  PersonalWorkflowConflictError,
  PersonalWorkflowNotFoundError,
  requirePersonalWorkflowTemplate,
  type CompletePersonalWorkflowStepInput,
  type ListPersonalWorkflowsInput,
  type PersonalWorkflow,
  type PersonalWorkflowDetail,
  type PersonalWorkflowEvent,
  type PersonalWorkflowEventType,
  type PersonalWorkflowKind,
  type PersonalWorkflowStatus,
  type PersonalWorkflowStore,
  type ReviewPersonalWorkflowInput,
  type StartPersonalWorkflowInput,
} from "../domain/personal-workflow.js";

interface WorkflowRow {
  readonly id: string;
  readonly actor_id: string;
  readonly workspace_id: string;
  readonly task_id: string;
  readonly kind: PersonalWorkflowKind;
  readonly status: PersonalWorkflowStatus;
  readonly current_step_index: number | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly completed_at: string | null;
}

interface WorkflowEventRow {
  readonly id: string;
  readonly workflow_id: string;
  readonly event_type: PersonalWorkflowEventType;
  readonly step_id: string | null;
  readonly summary: string;
  readonly created_at: string;
}

export class SqlitePersonalWorkflowStore implements PersonalWorkflowStore {
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

  start(input: StartPersonalWorkflowInput): PersonalWorkflowDetail {
    const template = requirePersonalWorkflowTemplate(input.kind);
    const active = this.database
      .prepare(
        `SELECT id FROM personal_workflows
         WHERE actor_id = ? AND workspace_id = ? AND task_id = ? AND kind = ?
           AND status IN ('active', 'awaiting_review')`,
      )
      .get(input.actorId, input.workspaceId, input.taskId, input.kind);
    if (active) {
      throw new PersonalWorkflowConflictError(
        "This task already has an active workflow of that kind.",
      );
    }

    const id = randomUUID();
    const now = this.now().toISOString();
    const start = this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO personal_workflows
            (id, actor_id, workspace_id, task_id, kind, status,
             current_step_index, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'active', 0, ?, ?)`,
        )
        .run(
          id,
          input.actorId,
          input.workspaceId,
          input.taskId,
          input.kind,
          now,
          now,
        );
      this.insertEvent(
        id,
        "started",
        template.steps[0]?.id ?? null,
        "Workflow started.",
        now,
      );
    });
    try {
      start();
    } catch (error) {
      if (isUniqueConstraint(error)) {
        throw new PersonalWorkflowConflictError(
          "This task already has an active workflow of that kind.",
        );
      }
      throw error;
    }
    return this.get(id, input.actorId, input.workspaceId);
  }

  get(id: string, actorId: string, workspaceId: string): PersonalWorkflowDetail {
    const row = this.requireWorkflowRow(id, actorId, workspaceId);
    const events = this.database
      .prepare(
        `SELECT id, workflow_id, event_type, step_id, summary, created_at
         FROM personal_workflow_events
         WHERE workflow_id = ?
         ORDER BY sequence ASC`,
      )
      .all(id) as WorkflowEventRow[];
    return {
      workflow: mapWorkflow(row),
      template: requirePersonalWorkflowTemplate(row.kind),
      events: events.map(mapEvent),
    };
  }

  list(input: ListPersonalWorkflowsInput): readonly PersonalWorkflow[] {
    const filters = ["actor_id = ?", "workspace_id = ?"];
    const values: unknown[] = [input.actorId, input.workspaceId];
    if (input.taskId) {
      filters.push("task_id = ?");
      values.push(input.taskId);
    }
    if (input.status) {
      filters.push("status = ?");
      values.push(input.status);
    }
    const rows = this.database
      .prepare(
        `SELECT * FROM personal_workflows
         WHERE ${filters.join(" AND ")}
         ORDER BY updated_at DESC, created_at DESC`,
      )
      .all(...values) as WorkflowRow[];
    return rows.map(mapWorkflow);
  }

  completeStep(
    input: CompletePersonalWorkflowStepInput,
  ): PersonalWorkflowDetail {
    const complete = this.database.transaction(() => {
      const row = this.requireWorkflowRow(
        input.id,
        input.actorId,
        input.workspaceId,
      );
      if (row.status !== "active") {
        throw new PersonalWorkflowConflictError(
          "Only an active workflow step can be completed.",
        );
      }
      const template = requirePersonalWorkflowTemplate(row.kind);
      const step = row.current_step_index === null
        ? undefined
        : template.steps[row.current_step_index];
      if (!step || step.id !== input.stepId) {
        throw new PersonalWorkflowConflictError(
          "The completed step must match the workflow's current step.",
        );
      }

      const now = this.now().toISOString();
      this.insertEvent(
        row.id,
        "step_completed",
        step.id,
        input.summary,
        now,
      );
      const nextIndex = (row.current_step_index ?? 0) + 1;
      if (nextIndex >= template.steps.length) {
        this.database
          .prepare(
            `UPDATE personal_workflows
             SET status = 'awaiting_review', current_step_index = NULL,
                 updated_at = ?
             WHERE id = ?`,
          )
          .run(now, row.id);
        this.insertEvent(
          row.id,
          "submitted_for_review",
          null,
          "All required workflow steps are complete; human review is required.",
          now,
        );
      } else {
        this.database
          .prepare(
            `UPDATE personal_workflows
             SET current_step_index = ?, updated_at = ?
             WHERE id = ?`,
          )
          .run(nextIndex, now, row.id);
      }
    });
    complete();
    return this.get(input.id, input.actorId, input.workspaceId);
  }

  review(input: ReviewPersonalWorkflowInput): PersonalWorkflowDetail {
    const review = this.database.transaction(() => {
      const row = this.requireWorkflowRow(
        input.id,
        input.actorId,
        input.workspaceId,
      );
      const now = this.now().toISOString();

      if (input.decision === "cancelled") {
        if (row.status === "cancelled") return;
        if (row.status === "completed") {
          throw new PersonalWorkflowConflictError(
            "A completed workflow cannot be cancelled.",
          );
        }
        this.database
          .prepare(
            `UPDATE personal_workflows
             SET status = 'cancelled', current_step_index = NULL, updated_at = ?
             WHERE id = ?`,
          )
          .run(now, row.id);
        this.insertEvent(row.id, "cancelled", null, input.feedback, now);
        return;
      }

      if (row.status !== "awaiting_review") {
        if (row.status === "completed" && input.decision === "approved") return;
        throw new PersonalWorkflowConflictError(
          "The workflow must be awaiting review before this decision.",
        );
      }

      if (input.decision === "approved") {
        this.database
          .prepare(
            `UPDATE personal_workflows
             SET status = 'completed', current_step_index = NULL,
                 updated_at = ?, completed_at = ?
             WHERE id = ?`,
          )
          .run(now, now, row.id);
        this.insertEvent(row.id, "approved", null, input.feedback, now);
        return;
      }

      const template = requirePersonalWorkflowTemplate(row.kind);
      const returnIndex = template.steps.findIndex(
        (step) => step.id === input.returnToStepId,
      );
      if (returnIndex < 0) {
        throw new PersonalWorkflowConflictError(
          "The requested return step is not part of this workflow.",
        );
      }
      this.database
        .prepare(
          `UPDATE personal_workflows
           SET status = 'active', current_step_index = ?, updated_at = ?,
               completed_at = NULL
           WHERE id = ?`,
        )
        .run(returnIndex, now, row.id);
      this.insertEvent(
        row.id,
        "changes_requested",
        input.returnToStepId,
        input.feedback,
        now,
      );
    });
    review();
    return this.get(input.id, input.actorId, input.workspaceId);
  }

  close(): void {
    this.database.close();
  }

  private requireWorkflowRow(
    id: string,
    actorId: string,
    workspaceId: string,
  ): WorkflowRow {
    const row = this.database
      .prepare(
        `SELECT * FROM personal_workflows
         WHERE id = ? AND actor_id = ? AND workspace_id = ?`,
      )
      .get(id, actorId, workspaceId) as WorkflowRow | undefined;
    if (!row) throw new PersonalWorkflowNotFoundError();
    return row;
  }

  private insertEvent(
    workflowId: string,
    eventType: PersonalWorkflowEventType,
    stepId: string | null,
    summary: string,
    createdAt: string,
  ): void {
    this.database
      .prepare(
        `INSERT INTO personal_workflow_events
          (id, workflow_id, event_type, step_id, summary, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(randomUUID(), workflowId, eventType, stepId, summary, createdAt);
  }

  private migrate(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS personal_workflows (
        id TEXT PRIMARY KEY,
        actor_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN (
          'research', 'project_planning', 'drafting', 'repository_work',
          'briefing', 'follow_up_preparation'
        )),
        status TEXT NOT NULL CHECK(status IN (
          'active', 'awaiting_review', 'completed', 'cancelled'
        )),
        current_step_index INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );

      CREATE UNIQUE INDEX IF NOT EXISTS personal_workflows_one_active_kind
        ON personal_workflows(actor_id, workspace_id, task_id, kind)
        WHERE status IN ('active', 'awaiting_review');

      CREATE INDEX IF NOT EXISTS personal_workflows_scope_status
        ON personal_workflows(actor_id, workspace_id, status, updated_at DESC);

      CREATE TABLE IF NOT EXISTS personal_workflow_events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        workflow_id TEXT NOT NULL
          REFERENCES personal_workflows(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL CHECK(event_type IN (
          'started', 'step_completed', 'submitted_for_review', 'approved',
          'changes_requested', 'cancelled'
        )),
        step_id TEXT,
        summary TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS personal_workflow_events_workflow
        ON personal_workflow_events(workflow_id, sequence);
    `);
  }
}

function mapWorkflow(row: WorkflowRow): PersonalWorkflow {
  const template = requirePersonalWorkflowTemplate(row.kind);
  return {
    id: row.id,
    actorId: row.actor_id,
    workspaceId: row.workspace_id,
    taskId: row.task_id,
    kind: row.kind,
    status: row.status,
    currentStepId: row.current_step_index === null
      ? null
      : (template.steps[row.current_step_index]?.id ?? null),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

function mapEvent(row: WorkflowEventRow): PersonalWorkflowEvent {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    type: row.event_type,
    stepId: row.step_id,
    summary: row.summary,
    createdAt: row.created_at,
  };
}

function isUniqueConstraint(error: unknown): boolean {
  return error instanceof Error &&
    "code" in error &&
    error.code === "SQLITE_CONSTRAINT_UNIQUE";
}
