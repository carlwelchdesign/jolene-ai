export interface WatchedProjectDefinition {
  readonly id: string;
  readonly label: string;
  readonly rootPath: string;
  readonly planFile: string | null;
  readonly reviewWindowDays: number;
}

export interface WatchedProjectSummary {
  readonly id: string;
  readonly label: string;
  readonly planFile: string | null;
  readonly reviewWindowDays: number;
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

export class WatchedProjectNotFoundError extends Error {
  constructor() {
    super("The requested watched project is not configured.");
    this.name = "WatchedProjectNotFoundError";
  }
}
