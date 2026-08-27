import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import type { PrivateWorkScope } from "../domain/private-work-scope.js";
import type {
  PrivateBriefingClaim,
  PrivateBriefingPolicy,
  PrivateBriefingRun,
  PrivateBriefingScheduleState,
  PrivateBriefingStore,
} from "../domain/private-briefing.js";

interface ScheduleRow {
  actor_id: string;
  workspace_id: string;
  status: PrivateBriefingScheduleState["status"];
  next_run_at: string | null;
  last_run_at: string | null;
  delivery_count: number;
  budget_date: string;
  budget_delivery_count: number;
  policy_json: string;
  updated_at: string;
}

interface RunRow {
  id: string;
  actor_id: string;
  workspace_id: string;
  scheduled_for: string;
  generated_at: string;
  status: PrivateBriefingRun["status"];
  message: string;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string | null;
  delivered_at: string | null;
  error_code: string | null;
  created_at: string;
  updated_at: string;
}

export class SqlitePrivateBriefingStore implements PrivateBriefingStore {
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

  reconcile(
    scope: PrivateWorkScope,
    policy: PrivateBriefingPolicy,
    now: Date,
    nextRunAt: Date,
  ): void {
    const timestamp = now.toISOString();
    const policyJson = JSON.stringify(policy);
    this.database.transaction(() => {
      const existing = this.readSchedule(scope);
      if (!existing) {
        this.database.prepare(
          `INSERT INTO private_briefing_schedules
           (actor_id, workspace_id, status, next_run_at, last_run_at,
            delivery_count, budget_date, budget_delivery_count, policy_json, updated_at)
           VALUES (?, ?, ?, ?, NULL, 0, ?, 0, ?, ?)`,
        ).run(
          scope.actorId,
          scope.workspaceId,
          policy.enabled ? "active" : "paused",
          policy.enabled ? nextRunAt.toISOString() : null,
          localDate(now, policy.timeZone),
          policyJson,
          timestamp,
        );
      } else {
        const stopped = existing.delivery_count >= policy.stopAfterDeliveries;
        const policyChanged = existing.policy_json !== policyJson;
        const status = stopped
          ? "stopped"
          : policy.enabled
            ? existing.status
            : "paused";
        const scheduled = status !== "active"
          ? null
          : policyChanged
            ? nextRunAt.toISOString()
            : existing.next_run_at ?? nextRunAt.toISOString();
        this.database.prepare(
          `UPDATE private_briefing_schedules SET status = ?, next_run_at = ?,
           policy_json = ?, updated_at = ? WHERE actor_id = ? AND workspace_id = ?`,
        ).run(
          status,
          scheduled,
          policyJson,
          timestamp,
          scope.actorId,
          scope.workspaceId,
        );
      }

      const staleBefore = new Date(now.getTime() - 10 * 60_000).toISOString();
      this.database.prepare(
        `UPDATE private_briefing_runs SET
         status = CASE WHEN attempts >= max_attempts THEN 'abandoned' ELSE 'failed' END,
         next_attempt_at = CASE WHEN attempts >= max_attempts THEN NULL ELSE ? END,
         error_code = 'delivery_interrupted', updated_at = ?
         WHERE actor_id = ? AND workspace_id = ? AND status = 'sending'
           AND updated_at <= ?`,
      ).run(timestamp, timestamp, scope.actorId, scope.workspaceId, staleBefore);
      this.prune(scope, policy.historyLimit);
    }).immediate();
  }

  get(scope: PrivateWorkScope, historyLimit: number): PrivateBriefingScheduleState {
    const row = this.readSchedule(scope);
    if (!row) throw new Error("private_briefing_not_found");
    const policy = JSON.parse(row.policy_json) as PrivateBriefingPolicy;
    const history = this.database.prepare(
      `SELECT * FROM private_briefing_runs WHERE actor_id = ? AND workspace_id = ?
       ORDER BY scheduled_for DESC, created_at DESC LIMIT ?`,
    ).all(scope.actorId, scope.workspaceId, historyLimit) as RunRow[];
    return {
      status: row.status,
      nextRunAt: row.next_run_at,
      lastRunAt: row.last_run_at,
      deliveryCount: row.delivery_count,
      deliveriesToday: row.budget_date === localDate(this.now(), policy.timeZone)
        ? row.budget_delivery_count
        : 0,
      policy,
      history: history.map(mapRun),
    };
  }

  setStatus(
    scope: PrivateWorkScope,
    status: "active" | "paused",
    now: Date,
    nextRunAt: Date,
  ): void {
    const row = this.readSchedule(scope);
    if (!row || row.status === "stopped") throw new Error("private_briefing_not_mutable");
    const policy = JSON.parse(row.policy_json) as PrivateBriefingPolicy;
    if (status === "active" && !policy.enabled) {
      throw new Error("private_briefing_policy_disabled");
    }
    this.database.prepare(
      `UPDATE private_briefing_schedules SET status = ?, next_run_at = ?, updated_at = ?
       WHERE actor_id = ? AND workspace_id = ? AND status != 'stopped'`,
    ).run(
      status,
      status === "active" ? nextRunAt.toISOString() : null,
      now.toISOString(),
      scope.actorId,
      scope.workspaceId,
    );
  }

  claim(
    scope: PrivateWorkScope,
    policy: PrivateBriefingPolicy,
    now: Date,
    nextRunAt: Date,
    message: string,
  ): PrivateBriefingClaim | null {
    return this.database.transaction(() => {
      const schedule = this.readSchedule(scope);
      if (!schedule || schedule.status !== "active" || !policy.enabled) return null;
      const staleBefore = new Date(now.getTime() - 10 * 60_000).toISOString();
      this.database.prepare(
        `UPDATE private_briefing_runs SET
         status = CASE WHEN attempts >= max_attempts THEN 'abandoned' ELSE 'failed' END,
         next_attempt_at = CASE WHEN attempts >= max_attempts THEN NULL ELSE ? END,
         error_code = 'delivery_interrupted', updated_at = ?
         WHERE actor_id = ? AND workspace_id = ? AND status = 'sending'
           AND updated_at <= ?`,
      ).run(
        now.toISOString(),
        now.toISOString(),
        scope.actorId,
        scope.workspaceId,
        staleBefore,
      );
      const retry = this.database.prepare(
        `SELECT * FROM private_briefing_runs
         WHERE actor_id = ? AND workspace_id = ? AND status = 'failed'
           AND next_attempt_at <= ? AND attempts < max_attempts
         ORDER BY created_at ASC LIMIT 1`,
      ).get(scope.actorId, scope.workspaceId, now.toISOString()) as RunRow | undefined;
      if (retry) {
        const attempts = retry.attempts + 1;
        const changed = this.database.prepare(
          `UPDATE private_briefing_runs SET status = 'sending', attempts = ?, updated_at = ?
           WHERE id = ? AND status = 'failed'`,
        ).run(attempts, now.toISOString(), retry.id);
        return changed.changes === 1
          ? mapClaim({ ...retry, status: "sending", attempts, updated_at: now.toISOString() })
          : null;
      }

      const row = this.readSchedule(scope);
      if (!row?.next_run_at) return null;
      if (row.next_run_at > now.toISOString()) return null;
      const budgetDate = localDate(now, policy.timeZone);
      const used = row.budget_date === budgetDate ? row.budget_delivery_count : 0;
      if (
        used >= policy.maxDeliveriesPerDay ||
        row.delivery_count >= policy.stopAfterDeliveries
      ) return null;

      const id = randomUUID();
      const scheduledFor = row.next_run_at;
      const timestamp = now.toISOString();
      this.database.prepare(
        `INSERT INTO private_briefing_runs
         (id, actor_id, workspace_id, scheduled_for, generated_at, status, message,
          attempts, max_attempts, next_attempt_at, delivered_at, error_code,
          created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'sending', ?, 1, ?, NULL, NULL, NULL, ?, ?)`,
      ).run(
        id,
        scope.actorId,
        scope.workspaceId,
        scheduledFor,
        timestamp,
        message,
        policy.maxAttempts,
        timestamp,
        timestamp,
      );
      this.database.prepare(
        `UPDATE private_briefing_schedules SET next_run_at = ?, last_run_at = ?,
         budget_date = ?, budget_delivery_count = ?, updated_at = ?
         WHERE actor_id = ? AND workspace_id = ?`,
      ).run(
        nextRunAt.toISOString(),
        timestamp,
        budgetDate,
        used + 1,
        timestamp,
        scope.actorId,
        scope.workspaceId,
      );
      return mapClaim({
        id,
        actor_id: scope.actorId,
        workspace_id: scope.workspaceId,
        scheduled_for: scheduledFor,
        generated_at: timestamp,
        status: "sending",
        message,
        attempts: 1,
        max_attempts: policy.maxAttempts,
        next_attempt_at: null,
        delivered_at: null,
        error_code: null,
        created_at: timestamp,
        updated_at: timestamp,
      });
    }).immediate();
  }

  complete(id: string, deliveredAt: Date): void {
    this.database.transaction(() => {
      const run = this.database.prepare(
        `SELECT actor_id, workspace_id FROM private_briefing_runs
         WHERE id = ? AND status = 'sending'`,
      ).get(id) as Pick<RunRow, "actor_id" | "workspace_id"> | undefined;
      if (!run) return;
      const timestamp = deliveredAt.toISOString();
      this.database.prepare(
        `UPDATE private_briefing_runs SET status = 'delivered', delivered_at = ?,
         next_attempt_at = NULL, error_code = NULL, updated_at = ?
         WHERE id = ? AND status = 'sending'`,
      ).run(timestamp, timestamp, id);
      const schedule = this.database.prepare(
        `SELECT delivery_count, policy_json FROM private_briefing_schedules
         WHERE actor_id = ? AND workspace_id = ?`,
      ).get(run.actor_id, run.workspace_id) as Pick<ScheduleRow, "delivery_count" | "policy_json">;
      const policy = JSON.parse(schedule.policy_json) as PrivateBriefingPolicy;
      const deliveryCount = schedule.delivery_count + 1;
      const stopped = deliveryCount >= policy.stopAfterDeliveries;
      this.database.prepare(
        `UPDATE private_briefing_schedules SET delivery_count = ?,
         status = CASE WHEN ? = 1 THEN 'stopped' ELSE status END,
         next_run_at = CASE WHEN ? = 1 THEN NULL ELSE next_run_at END, updated_at = ?
         WHERE actor_id = ? AND workspace_id = ?`,
      ).run(
        deliveryCount,
        stopped ? 1 : 0,
        stopped ? 1 : 0,
        timestamp,
        run.actor_id,
        run.workspace_id,
      );
      this.prune(
        { actorId: run.actor_id, workspaceId: run.workspace_id },
        policy.historyLimit,
      );
    }).immediate();
  }

  fail(id: string, failedAt: Date, errorCode: string): void {
    this.database.transaction(() => {
      const row = this.database.prepare(
        `SELECT attempts, max_attempts FROM private_briefing_runs
         WHERE id = ? AND status = 'sending'`,
      ).get(id) as Pick<RunRow, "attempts" | "max_attempts"> | undefined;
      if (!row) return;
      const abandoned = row.attempts >= row.max_attempts;
      const nextAttemptAt = abandoned
        ? null
        : new Date(failedAt.getTime() + retryDelayMilliseconds(row.attempts)).toISOString();
      this.database.prepare(
        `UPDATE private_briefing_runs SET status = ?, next_attempt_at = ?,
         error_code = ?, updated_at = ? WHERE id = ? AND status = 'sending'`,
      ).run(
        abandoned ? "abandoned" : "failed",
        nextAttemptAt,
        normalizeErrorCode(errorCode),
        failedAt.toISOString(),
        id,
      );
    }).immediate();
  }

  close(): void { this.database.close(); }

  private readSchedule(scope: PrivateWorkScope): ScheduleRow | undefined {
    return this.database.prepare(
      `SELECT * FROM private_briefing_schedules WHERE actor_id = ? AND workspace_id = ?`,
    ).get(scope.actorId, scope.workspaceId) as ScheduleRow | undefined;
  }

  private prune(scope: PrivateWorkScope, historyLimit: number): void {
    this.database.prepare(
      `DELETE FROM private_briefing_runs WHERE actor_id = ? AND workspace_id = ?
       AND id NOT IN (
         SELECT id FROM private_briefing_runs WHERE actor_id = ? AND workspace_id = ?
         ORDER BY scheduled_for DESC, created_at DESC LIMIT ?
       ) AND status IN ('delivered', 'abandoned')`,
    ).run(
      scope.actorId,
      scope.workspaceId,
      scope.actorId,
      scope.workspaceId,
      historyLimit,
    );
  }

  private migrate(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS private_briefing_schedules (
        actor_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('active', 'paused', 'stopped')),
        next_run_at TEXT,
        last_run_at TEXT,
        delivery_count INTEGER NOT NULL,
        budget_date TEXT NOT NULL,
        budget_delivery_count INTEGER NOT NULL,
        policy_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(actor_id, workspace_id)
      );
      CREATE TABLE IF NOT EXISTS private_briefing_runs (
        id TEXT PRIMARY KEY,
        actor_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        scheduled_for TEXT NOT NULL,
        generated_at TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('sending', 'failed', 'delivered', 'abandoned')),
        message TEXT NOT NULL,
        attempts INTEGER NOT NULL,
        max_attempts INTEGER NOT NULL,
        next_attempt_at TEXT,
        delivered_at TEXT,
        error_code TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(actor_id, workspace_id)
          REFERENCES private_briefing_schedules(actor_id, workspace_id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_private_briefing_scheduled_once
      ON private_briefing_runs(actor_id, workspace_id, scheduled_for);
      CREATE INDEX IF NOT EXISTS idx_private_briefing_due
      ON private_briefing_runs(status, next_attempt_at, created_at);
    `);
  }
}

function mapRun(row: RunRow): PrivateBriefingRun {
  return {
    id: row.id,
    scheduledFor: row.scheduled_for,
    generatedAt: row.generated_at,
    status: row.status,
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    deliveredAt: row.delivered_at,
    errorCode: row.error_code,
  };
}

function mapClaim(row: RunRow): PrivateBriefingClaim {
  return { ...mapRun(row), message: row.message, maxAttempts: row.max_attempts };
}

function localDate(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function retryDelayMilliseconds(attempts: number): number {
  return [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000][
    Math.min(attempts - 1, 3)
  ] ?? 60 * 60_000;
}

function normalizeErrorCode(value: string): string {
  const normalized = value.toLowerCase().replaceAll(/[^a-z0-9_-]/g, "_").slice(0, 80);
  return normalized || "unknown_error";
}
