import type {
  PersonalWorkflowKind,
  PersonalWorkflowStatus,
} from "./personal-workflow.js";
import type { PrivateWorkScope } from "./private-work-scope.js";
import type { TaskStatus } from "./work-context.js";

export interface ReviewWorkStatusInput extends PrivateWorkScope {
  readonly statuses?: readonly TaskStatus[];
  readonly limit: number;
}

export interface WorkStatusWorkflow {
  readonly id: string;
  readonly kind: PersonalWorkflowKind;
  readonly status: PersonalWorkflowStatus;
  readonly currentStepId: string | null;
  readonly updatedAt: string;
}

export interface WorkStatusTask {
  readonly id: string;
  readonly title: string;
  readonly objective: string;
  readonly objectiveTruncated: boolean;
  readonly status: TaskStatus;
  readonly updatedAt: string;
  readonly workflows: readonly WorkStatusWorkflow[];
}

export interface WorkStatusSnapshot {
  readonly totalTaskCount: number;
  readonly matchingTaskCount: number;
  readonly returnedTaskCount: number;
  readonly truncated: boolean;
  readonly statusCounts: Readonly<Record<TaskStatus, number>>;
  readonly tasks: readonly WorkStatusTask[];
}

export interface WorkStatusSource {
  review(input: ReviewWorkStatusInput): WorkStatusSnapshot;
}
