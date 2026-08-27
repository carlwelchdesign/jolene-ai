import { nextPrivateBriefingOccurrence } from "../domain/private-briefing-schedule.js";
import type { PrivateWorkScope } from "../domain/private-work-scope.js";
import type {
  PrivateBriefingPolicy,
  PrivateBriefingSnapshot,
  PrivateBriefingSource,
  PrivateBriefingStore,
  PrivateBriefingView,
} from "../domain/private-briefing.js";
import type { WatchedProjectAlert } from "../domain/watched-project.js";

export interface PrivateBriefingOwnerNotification {
  readonly notificationId: string;
  readonly text: string;
}

export type PostPrivateBriefingOwnerNotification = (
  notification: PrivateBriefingOwnerNotification,
) => Promise<void>;

export class PrivateBriefingConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrivateBriefingConflictError";
  }
}

export class PrivateBriefingService {
  constructor(
    private readonly policy: PrivateBriefingPolicy,
    private readonly store: PrivateBriefingStore,
    private readonly source: PrivateBriefingSource,
    private readonly ownerScope: PrivateWorkScope,
    private readonly now: () => Date = () => new Date(),
  ) {
    const current = this.now();
    store.reconcile(
      ownerScope,
      policy,
      current,
      nextPrivateBriefingOccurrence(current, policy),
    );
  }

  view(): PrivateBriefingView {
    const preview = this.source.snapshot(this.ownerScope);
    return {
      ...this.store.get(this.ownerScope, this.policy.historyLimit),
      preview,
      previewMessage: renderPrivateBriefing(preview),
    };
  }

  pause(): PrivateBriefingView {
    const current = this.now();
    this.store.setStatus(
      this.ownerScope,
      "paused",
      current,
      nextPrivateBriefingOccurrence(current, this.policy),
    );
    return this.view();
  }

  resume(): PrivateBriefingView {
    if (!this.policy.enabled) {
      throw new PrivateBriefingConflictError(
        "Private briefings are disabled in the owner's local configuration.",
      );
    }
    const state = this.store.get(this.ownerScope, this.policy.historyLimit);
    if (state.status === "stopped") {
      throw new PrivateBriefingConflictError(
        "Private briefings reached their configured stop condition.",
      );
    }
    const current = this.now();
    try {
      this.store.setStatus(
        this.ownerScope,
        "active",
        current,
        nextPrivateBriefingOccurrence(current, this.policy),
      );
    } catch (error) {
      throw new PrivateBriefingConflictError(classifyConflict(error));
    }
    return this.view();
  }

  async drainPending(
    post: PostPrivateBriefingOwnerNotification,
    limit = 2,
  ): Promise<{ readonly delivered: number; readonly failed: number }> {
    if (!this.policy.enabled) return { delivered: 0, failed: 0 };
    let delivered = 0;
    let failed = 0;
    for (let index = 0; index < limit; index += 1) {
      const current = this.now();
      const snapshot = this.source.snapshot(this.ownerScope);
      const claim = this.store.claim(
        this.ownerScope,
        this.policy,
        current,
        nextPrivateBriefingOccurrence(current, this.policy),
        renderPrivateBriefing(snapshot),
      );
      if (!claim) break;
      try {
        await post({ notificationId: claim.id, text: claim.message });
        this.store.complete(claim.id, this.now());
        delivered += 1;
      } catch (error) {
        this.store.fail(claim.id, this.now(), classifyError(error));
        failed += 1;
      }
    }
    return { delivered, failed };
  }

  close(): void { this.store.close(); }
}

export function renderPrivateBriefing(snapshot: PrivateBriefingSnapshot): string {
  const tasks = snapshot.taskStatusCounts;
  const workflows = snapshot.workflowStatusCounts;
  const lines = [
    "Good morning, Carl — here’s your private Jolene briefing.",
    `Tasks: ${tasks.running} running, ${tasks.approval_needed} awaiting approval, ${tasks.retryable} retryable, ${tasks.failed} failed, ${tasks.pending} pending.`,
  ];
  if (snapshot.attentionTasks.length > 0) {
    lines.push("Needs attention:");
    snapshot.attentionTasks.forEach((task) => {
      lines.push(`• ${sanitizeSlackText(task.title)} — ${task.status.replaceAll("_", " ")}`);
    });
  }
  if (snapshot.activeTasks.length > 0) {
    lines.push("In motion:");
    snapshot.activeTasks.forEach((task) => {
      lines.push(`• ${sanitizeSlackText(task.title)}`);
    });
  }
  lines.push(
    `Workflows: ${workflows.active} active, ${workflows.awaiting_review} awaiting review, ${workflows.completed} completed.`,
    `External actions awaiting your approval: ${snapshot.pendingActionApprovalCount}.`,
  );
  if (snapshot.projects.length > 0) {
    lines.push("Project watch:");
    snapshot.projects.forEach((project) => {
      const alerts = project.alerts.length === 0
        ? "clear"
        : project.alerts.map(alertLabel).join(", ");
      lines.push(`• ${sanitizeSlackText(project.label)} — ${alerts}`);
    });
  }
  if (snapshot.truncated) lines.push("Some sections were clipped to the private briefing limit.");
  lines.push("Review locally: http://127.0.0.1:8421/work");
  return lines.join("\n");
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

function sanitizeSlackText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll("@", "＠").replaceAll(/\s+/g, " ").trim();
}

function classifyError(error: unknown): string {
  return error instanceof Error && error.name ? error.name : "unknown_error";
}

function classifyConflict(error: unknown): string {
  if (error instanceof Error && error.message === "private_briefing_policy_disabled") {
    return "Private briefings are disabled in the owner's local configuration.";
  }
  if (error instanceof Error && error.message === "private_briefing_not_mutable") {
    return "Private briefings reached their configured stop condition.";
  }
  return "The private briefing schedule could not be resumed.";
}
