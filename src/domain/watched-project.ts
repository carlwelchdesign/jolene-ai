import type { PrivateWorkScope } from "./private-work-scope.js";

export interface WatchedProjectDefinition {
  readonly id: string;
  readonly label: string;
  readonly rootPath: string;
  readonly planFile: string | null;
  readonly reviewWindowDays: number;
  readonly monitoring: WatchedProjectMonitoringPolicy;
}

export interface WatchedProjectMonitoringPolicy {
  readonly enabled: boolean;
  readonly cadenceMinutes: number;
  readonly maxRunsPerDay: number;
  readonly stopAfterRuns: number;
  readonly historyLimit: number;
}

export interface WatchedProjectSummary {
  readonly id: string;
  readonly label: string;
  readonly planFile: string | null;
  readonly reviewWindowDays: number;
  readonly monitoring: WatchedProjectMonitoringPolicy;
}

export type WatchedProjectAlert =
  | "root_missing"
  | "git_not_initialized"
  | "git_unavailable"
  | "plan_missing"
  | "plan_stale"
  | "uncommitted_changes";

export interface WatchedProjectSnapshot {
  readonly id: string;
  readonly label: string;
  readonly checkedAt: string;
  readonly rootExists: boolean;
  readonly git: {
    readonly state: "available" | "not_repository" | "unavailable";
    readonly branch: string | null;
    readonly revision: string | null;
    readonly dirty: boolean | null;
    readonly changedFileCount: number | null;
  };
  readonly plan: {
    readonly configured: boolean;
    readonly relativePath: string | null;
    readonly exists: boolean;
    readonly modifiedAt: string | null;
    readonly ageDays: number | null;
  };
  readonly verification: {
    readonly state: "not_configured";
    readonly checkedAt: null;
  };
  readonly alerts: readonly WatchedProjectAlert[];
}

export interface WatchedProjectInspector {
  inspect(project: WatchedProjectDefinition): Promise<WatchedProjectSnapshot>;
}

export interface WatchedProjectDirectory {
  list(): readonly WatchedProjectSummary[];
  snapshot(id: string): Promise<WatchedProjectSnapshot>;
}

export type WatchedProjectMonitorStatus = "active" | "paused" | "stopped";

export interface WatchedProjectMonitorRun {
  readonly id: string;
  readonly projectId: string;
  readonly trigger: "scheduled" | "manual";
  readonly status: "running" | "succeeded" | "failed";
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly snapshot: WatchedProjectSnapshot | null;
  readonly errorCode: "inspection_failed" | null;
}

export interface WatchedProjectMonitorState {
  readonly projectId: string;
  readonly status: WatchedProjectMonitorStatus;
  readonly nextRunAt: string | null;
  readonly lastRunAt: string | null;
  readonly runCount: number;
  readonly runsToday: number;
  readonly policy: WatchedProjectMonitoringPolicy;
  readonly history: readonly WatchedProjectMonitorRun[];
}

export interface WatchedProjectMonitorStore {
  reconcile(project: WatchedProjectDefinition): void;
  get(projectId: string, historyLimit: number): WatchedProjectMonitorState | null;
  setStatus(projectId: string, status: "active" | "paused", now: Date): void;
  claim(
    project: WatchedProjectDefinition,
    trigger: "scheduled" | "manual",
    now: Date,
  ): WatchedProjectMonitorRun | null;
  complete(
    runId: string,
    completedAt: Date,
    result:
      | { readonly snapshot: WatchedProjectSnapshot }
      | { readonly errorCode: "inspection_failed" },
  ): void;
  prune(projectId: string, historyLimit: number): void;
  close(): void;
}

export interface PrivateWatchedProjectSource {
  canReview(scope: PrivateWorkScope | null): boolean;
  list(scope: PrivateWorkScope): readonly WatchedProjectSummary[];
  snapshot(
    id: string,
    scope: PrivateWorkScope,
  ): Promise<WatchedProjectSnapshot>;
}

export class WatchedProjectNotFoundError extends Error {
  constructor() {
    super("The requested watched project is not configured.");
    this.name = "WatchedProjectNotFoundError";
  }
}

export class WatchedProjectAccessDeniedError extends Error {
  constructor() {
    super("The private watched-project scope is unavailable.");
    this.name = "WatchedProjectAccessDeniedError";
  }
}
