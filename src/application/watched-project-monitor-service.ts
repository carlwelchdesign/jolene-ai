import {
  WatchedProjectNotFoundError,
  type WatchedProjectDefinition,
  type WatchedProjectInspector,
  type WatchedProjectMonitorState,
  type WatchedProjectMonitorStore,
} from "../domain/watched-project.js";
import { deriveWatchedProjectNotification } from "../domain/watched-project-notification.js";

export class WatchedProjectMonitorConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WatchedProjectMonitorConflictError";
  }
}

export class WatchedProjectMonitorService {
  private readonly projects: ReadonlyMap<string, WatchedProjectDefinition>;

  constructor(
    projects: readonly WatchedProjectDefinition[],
    private readonly inspector: WatchedProjectInspector,
    private readonly store: WatchedProjectMonitorStore,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.projects = new Map(projects.map((project) => [project.id, project]));
    projects.forEach((project) => store.reconcile(project));
  }

  list(): readonly WatchedProjectMonitorState[] {
    return [...this.projects.values()].map((project) => this.requireState(project));
  }

  get(projectId: string): WatchedProjectMonitorState {
    return this.requireState(this.requireProject(projectId));
  }

  pause(projectId: string): WatchedProjectMonitorState {
    const project = this.requireProject(projectId);
    if (this.requireState(project).status === "stopped") {
      throw new WatchedProjectMonitorConflictError(
        "This monitor reached its configured stop condition.",
      );
    }
    this.store.setStatus(project.id, "paused", this.now());
    return this.requireState(project);
  }

  resume(projectId: string): WatchedProjectMonitorState {
    const project = this.requireProject(projectId);
    if (!project.monitoring.enabled) {
      throw new WatchedProjectMonitorConflictError(
        "Scheduled monitoring is not enabled in this project's owner configuration.",
      );
    }
    const current = this.requireState(project);
    if (current.status === "stopped") {
      throw new WatchedProjectMonitorConflictError(
        "This monitor reached its configured stop condition.",
      );
    }
    this.store.setStatus(project.id, "active", this.now());
    return this.requireState(project);
  }

  async runNow(projectId: string): Promise<WatchedProjectMonitorState> {
    const project = this.requireProject(projectId);
    await this.run(project, "manual");
    return this.requireState(project);
  }

  async runDue(): Promise<number> {
    let completed = 0;
    for (const project of this.projects.values()) {
      if (await this.run(project, "scheduled")) completed += 1;
    }
    return completed;
  }

  close(): void { this.store.close(); }

  private async run(
    project: WatchedProjectDefinition,
    trigger: "scheduled" | "manual",
  ): Promise<boolean> {
    const run = this.store.claim(project, trigger, this.now());
    if (!run) {
      if (trigger === "manual") {
        throw new WatchedProjectMonitorConflictError(
          "The monitor is busy, stopped, or has reached today's run budget.",
        );
      }
      return false;
    }
    try {
      const snapshot = await this.inspector.inspect(project);
      this.store.complete(run.id, this.now(), {
        snapshot,
        notification: deriveWatchedProjectNotification(
          run.previousSnapshot,
          snapshot,
          trigger,
          project.monitoring.notifications,
        ),
        notificationMaxAttempts: project.monitoring.notifications.maxAttempts,
      });
    } catch {
      this.store.complete(run.id, this.now(), { errorCode: "inspection_failed" });
    }
    this.store.prune(project.id, project.monitoring.historyLimit);
    return true;
  }

  private requireProject(projectId: string): WatchedProjectDefinition {
    const project = this.projects.get(projectId);
    if (!project) throw new WatchedProjectNotFoundError();
    return project;
  }

  private requireState(project: WatchedProjectDefinition): WatchedProjectMonitorState {
    const state = this.store.get(project.id, project.monitoring.historyLimit);
    if (!state) throw new WatchedProjectNotFoundError();
    return state;
  }
}
