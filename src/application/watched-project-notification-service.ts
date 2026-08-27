import type {
  WatchedProjectAlert,
  WatchedProjectDefinition,
  WatchedProjectNotificationClaim,
  WatchedProjectNotificationOutbox,
} from "../domain/watched-project.js";

export interface ProjectWatchOwnerNotification {
  readonly notificationId: string;
  readonly text: string;
}

export type PostProjectWatchOwnerNotification = (
  notification: ProjectWatchOwnerNotification,
) => Promise<void>;

export class WatchedProjectNotificationService {
  private readonly projects: ReadonlyMap<string, WatchedProjectDefinition>;

  constructor(
    projects: readonly WatchedProjectDefinition[],
    private readonly store: WatchedProjectNotificationOutbox,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.projects = new Map(projects.map((project) => [project.id, project]));
  }

  async drainPending(
    post: PostProjectWatchOwnerNotification,
    limit = 10,
  ): Promise<{ readonly delivered: number; readonly failed: number }> {
    let delivered = 0;
    let failed = 0;
    for (let index = 0; index < limit; index += 1) {
      const claim = this.store.claimNotification(this.now());
      if (!claim) break;
      const project = this.projects.get(claim.projectId);
      if (!project || !project.monitoring.notifications.enabled) {
        this.store.failNotification(
          claim.id,
          this.now(),
          "notification_policy_disabled",
        );
        failed += 1;
        continue;
      }
      try {
        await post({
          notificationId: claim.id,
          text: renderNotification(sanitizeSlackText(project.label), claim),
        });
        this.store.completeNotification(claim.id, this.now());
        delivered += 1;
      } catch (error) {
        this.store.failNotification(claim.id, this.now(), classifyError(error));
        failed += 1;
      }
    }
    return { delivered, failed };
  }
}

function renderNotification(
  projectLabel: string,
  notification: WatchedProjectNotificationClaim,
): string {
  const checked = new Date(notification.checkedAt);
  const time = Number.isNaN(checked.valueOf())
    ? "at an unknown time"
    : checked.toISOString();
  const alerts = notification.alertCodes.map(alertLabel).join(", ");
  if (notification.transition === "attention_resolved") {
    return `Project Watch: ${projectLabel} is clear. Resolved: ${alerts}. Checked ${time}.`;
  }
  const transition = notification.transition === "attention_started"
    ? "needs attention"
    : "has a changed alert state";
  return `Project Watch: ${projectLabel} ${transition}. Alerts: ${alerts}. Checked ${time}. Review: http://127.0.0.1:8421/projects`;
}

function alertLabel(alert: WatchedProjectAlert): string {
  const labels: Record<WatchedProjectAlert, string> = {
    root_missing: "project folder missing",
    git_not_initialized: "Git not initialized",
    git_unavailable: "Git status unavailable",
    plan_missing: "project plan missing",
    plan_stale: "project plan stale",
    uncommitted_changes: "uncommitted local changes",
  };
  return labels[alert];
}

function classifyError(error: unknown): string {
  if (error instanceof Error && error.name) return error.name;
  return "unknown_error";
}

function sanitizeSlackText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll(/\s+/g, " ")
    .trim();
}
