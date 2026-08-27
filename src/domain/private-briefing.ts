import type { PersonalWorkflowStatus } from "./personal-workflow.js";
import type { PrivateWorkScope } from "./private-work-scope.js";
import type { TaskStatus } from "./work-context.js";
import type { WatchedProjectAlert } from "./watched-project.js";

export interface PrivateBriefingPolicy {
  readonly enabled: boolean;
  readonly destination: "slack_owner_dm";
  readonly frequency: "daily" | "weekly";
  readonly dayOfWeek: number | null;
  readonly localHour: number;
  readonly localMinute: number;
  readonly timeZone: string;
  readonly maxDeliveriesPerDay: number;
  readonly stopAfterDeliveries: number;
  readonly historyLimit: number;
  readonly maxAttempts: number;
}

export interface PrivateBriefingTaskItem {
  readonly title: string;
  readonly status: TaskStatus;
}

export interface PrivateBriefingProjectItem {
  readonly label: string;
  readonly alerts: readonly WatchedProjectAlert[];
}

export interface PrivateBriefingSnapshot {
  readonly generatedAt: string;
  readonly taskStatusCounts: Readonly<Record<TaskStatus, number>>;
  readonly attentionTasks: readonly PrivateBriefingTaskItem[];
  readonly activeTasks: readonly PrivateBriefingTaskItem[];
  readonly workflowStatusCounts: Readonly<Record<PersonalWorkflowStatus, number>>;
  readonly projects: readonly PrivateBriefingProjectItem[];
  readonly pendingActionApprovalCount: number;
  readonly truncated: boolean;
}

export interface PrivateBriefingSource {
  snapshot(scope: PrivateWorkScope): PrivateBriefingSnapshot;
}

export interface PrivateBriefingRun {
  readonly id: string;
  readonly scheduledFor: string;
  readonly generatedAt: string;
  readonly status: "sending" | "failed" | "delivered" | "abandoned";
  readonly attempts: number;
  readonly nextAttemptAt: string | null;
  readonly deliveredAt: string | null;
  readonly errorCode: string | null;
}

export interface PrivateBriefingClaim extends PrivateBriefingRun {
  readonly message: string;
  readonly maxAttempts: number;
}

export interface PrivateBriefingScheduleState {
  readonly status: "active" | "paused" | "stopped";
  readonly nextRunAt: string | null;
  readonly lastRunAt: string | null;
  readonly deliveryCount: number;
  readonly deliveriesToday: number;
  readonly policy: PrivateBriefingPolicy;
  readonly history: readonly PrivateBriefingRun[];
}

export interface PrivateBriefingView extends PrivateBriefingScheduleState {
  readonly preview: PrivateBriefingSnapshot;
  readonly previewMessage: string;
}

export interface PrivateBriefingStore {
  reconcile(
    scope: PrivateWorkScope,
    policy: PrivateBriefingPolicy,
    now: Date,
    nextRunAt: Date,
  ): void;
  get(scope: PrivateWorkScope, historyLimit: number): PrivateBriefingScheduleState;
  setStatus(
    scope: PrivateWorkScope,
    status: "active" | "paused",
    now: Date,
    nextRunAt: Date,
  ): void;
  claim(
    scope: PrivateWorkScope,
    policy: PrivateBriefingPolicy,
    now: Date,
    nextRunAt: Date,
    message: string,
  ): PrivateBriefingClaim | null;
  complete(id: string, deliveredAt: Date): void;
  fail(id: string, failedAt: Date, errorCode: string): void;
  close(): void;
}
