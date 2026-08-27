import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import type {
  WatchedProjectDefinition,
  WatchedProjectMonitorRun,
  WatchedProjectMonitorState,
  WatchedProjectMonitorStatus,
  WatchedProjectMonitorStore,
  WatchedProjectSnapshot,
} from "../domain/watched-project.js";

interface StateRow {
  project_id: string;
  status: WatchedProjectMonitorStatus;
  next_run_at: string | null;
  last_run_at: string | null;
  run_count: number;
  budget_date: string;
  budget_run_count: number;
  policy_json: string;
}

interface RunRow {
  id: string;
  project_id: string;
  trigger: "scheduled" | "manual";
  status: "running" | "succeeded" | "failed";
  started_at: string;
  completed_at: string | null;
  snapshot_json: string | null;
  error_code: "inspection_failed" | null;
}

export class SqliteWatchedProjectMonitorStore implements WatchedProjectMonitorStore {
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

  reconcile(project: WatchedProjectDefinition): void {
    const now = this.now().toISOString();
    const initialStatus = project.monitoring.enabled ? "active" : "paused";
    this.database.prepare(
      `INSERT INTO watched_project_monitors
       (project_id, status, next_run_at, last_run_at, run_count,
        budget_date, budget_run_count, policy_json, updated_at)
       VALUES (?, ?, ?, NULL, 0, ?, 0, ?, ?)
       ON CONFLICT(project_id) DO UPDATE SET
         status = CASE
           WHEN ? = 0 THEN 'paused'
           WHEN watched_project_monitors.run_count >= ? THEN 'stopped'
           ELSE watched_project_monitors.status END,
         next_run_at = CASE
           WHEN ? = 0 OR watched_project_monitors.run_count >= ? THEN NULL
           ELSE watched_project_monitors.next_run_at END,
         policy_json = excluded.policy_json,
         updated_at = excluded.updated_at`,
    ).run(
      project.id,
      initialStatus,
      project.monitoring.enabled ? now : null,
      utcDate(new Date(now)),
      JSON.stringify(project.monitoring),
      now,
      project.monitoring.enabled ? 1 : 0,
      project.monitoring.stopAfterRuns,
      project.monitoring.enabled ? 1 : 0,
      project.monitoring.stopAfterRuns,
    );
    const staleBefore = new Date(this.now().getTime() - 10 * 60_000).toISOString();
    this.database.prepare(
      `UPDATE watched_project_monitor_runs SET status = 'failed', completed_at = ?,
       error_code = 'inspection_failed' WHERE project_id = ? AND status = 'running'
       AND started_at <= ?`,
    ).run(now, project.id, staleBefore);
  }

  get(projectId: string, historyLimit: number): WatchedProjectMonitorState | null {
    const row = this.database.prepare(
      "SELECT * FROM watched_project_monitors WHERE project_id = ?",
    ).get(projectId) as StateRow | undefined;
    if (!row) return null;
    const runs = this.database.prepare(
      `SELECT * FROM watched_project_monitor_runs WHERE project_id = ?
       ORDER BY started_at DESC LIMIT ?`,
    ).all(projectId, historyLimit) as RunRow[];
    return {
      projectId,
      status: row.status,
      nextRunAt: row.next_run_at,
      lastRunAt: row.last_run_at,
      runCount: row.run_count,
      runsToday: row.budget_date === utcDate(this.now()) ? row.budget_run_count : 0,
      policy: JSON.parse(row.policy_json) as WatchedProjectDefinition["monitoring"],
      history: runs.map(mapRun),
    };
  }

  setStatus(projectId: string, status: "active" | "paused", now: Date): void {
    const nextRunAt = status === "active" ? now.toISOString() : null;
    const result = this.database.prepare(
      `UPDATE watched_project_monitors SET status = ?, next_run_at = ?, updated_at = ?
       WHERE project_id = ? AND status != 'stopped'`,
    ).run(status, nextRunAt, now.toISOString(), projectId);
    if (result.changes === 0) throw new Error("monitor_not_mutable");
  }

  claim(
    project: WatchedProjectDefinition,
    trigger: "scheduled" | "manual",
    now: Date,
  ): WatchedProjectMonitorRun | null {
    return this.database.transaction(() => {
      const row = this.database.prepare(
        "SELECT * FROM watched_project_monitors WHERE project_id = ?",
      ).get(project.id) as StateRow | undefined;
      if (!row) return null;
      const today = utcDate(now);
      const used = row.budget_date === today ? row.budget_run_count : 0;
      if (row.status === "stopped" || used >= project.monitoring.maxRunsPerDay) return null;
      if (trigger === "scheduled") {
        if (row.status !== "active" || !row.next_run_at || row.next_run_at > now.toISOString()) {
          return null;
        }
      }
      const running = this.database.prepare(
        `SELECT id FROM watched_project_monitor_runs
         WHERE project_id = ? AND status = 'running' LIMIT 1`,
      ).get(project.id);
      if (running) return null;

      const id = randomUUID();
      const startedAt = now.toISOString();
      const nextRunCount = row.run_count + 1;
      const stopped = nextRunCount >= project.monitoring.stopAfterRuns;
      const nextRunAt = stopped || row.status === "paused"
        ? null
        : new Date(now.getTime() + project.monitoring.cadenceMinutes * 60_000).toISOString();
      this.database.prepare(
        `INSERT INTO watched_project_monitor_runs
         (id, project_id, trigger, status, started_at)
         VALUES (?, ?, ?, 'running', ?)`,
      ).run(id, project.id, trigger, startedAt);
      this.database.prepare(
        `UPDATE watched_project_monitors SET status = ?, next_run_at = ?,
         last_run_at = ?, run_count = ?, budget_date = ?, budget_run_count = ?, updated_at = ?
         WHERE project_id = ?`,
      ).run(
        stopped ? "stopped" : row.status,
        nextRunAt,
        startedAt,
        nextRunCount,
        today,
        used + 1,
        startedAt,
        project.id,
      );
      return {
        id,
        projectId: project.id,
        trigger,
        status: "running" as const,
        startedAt,
        completedAt: null,
        snapshot: null,
        errorCode: null,
      };
    })();
  }

  complete(
    runId: string,
    completedAt: Date,
    result: { snapshot: WatchedProjectSnapshot } | { errorCode: "inspection_failed" },
  ): void {
    const success = "snapshot" in result;
    this.database.prepare(
      `UPDATE watched_project_monitor_runs SET status = ?, completed_at = ?,
       snapshot_json = ?, error_code = ? WHERE id = ? AND status = 'running'`,
    ).run(
      success ? "succeeded" : "failed",
      completedAt.toISOString(),
      success ? JSON.stringify(result.snapshot) : null,
      success ? null : result.errorCode,
      runId,
    );
  }

  prune(projectId: string, historyLimit: number): void {
    this.database.prepare(
      `DELETE FROM watched_project_monitor_runs WHERE project_id = ? AND id NOT IN (
        SELECT id FROM watched_project_monitor_runs WHERE project_id = ?
        ORDER BY started_at DESC LIMIT ?
      ) AND status != 'running'`,
    ).run(projectId, projectId, historyLimit);
  }

  close(): void { this.database.close(); }

  private migrate(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS watched_project_monitors (
        project_id TEXT PRIMARY KEY,
        status TEXT NOT NULL CHECK(status IN ('active', 'paused', 'stopped')),
        next_run_at TEXT,
        last_run_at TEXT,
        run_count INTEGER NOT NULL,
        budget_date TEXT NOT NULL,
        budget_run_count INTEGER NOT NULL,
        policy_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS watched_project_monitor_runs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        trigger TEXT NOT NULL CHECK(trigger IN ('scheduled', 'manual')),
        status TEXT NOT NULL CHECK(status IN ('running', 'succeeded', 'failed')),
        started_at TEXT NOT NULL,
        completed_at TEXT,
        snapshot_json TEXT,
        error_code TEXT,
        FOREIGN KEY(project_id) REFERENCES watched_project_monitors(project_id)
      );
      CREATE INDEX IF NOT EXISTS idx_watched_project_monitor_runs_project_started
      ON watched_project_monitor_runs(project_id, started_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_watched_project_monitor_one_running
      ON watched_project_monitor_runs(project_id) WHERE status = 'running';
    `);
  }
}

function mapRun(row: RunRow): WatchedProjectMonitorRun {
  return {
    id: row.id,
    projectId: row.project_id,
    trigger: row.trigger,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    snapshot: row.snapshot_json ? JSON.parse(row.snapshot_json) as WatchedProjectSnapshot : null,
    errorCode: row.error_code,
  };
}

function utcDate(date: Date): string { return date.toISOString().slice(0, 10); }
