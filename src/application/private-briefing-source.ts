import type { ActionProposal } from "../domain/action-approval.js";
import type { PersonalWorkflowStatus } from "../domain/personal-workflow.js";
import type { PrivateWorkScope } from "../domain/private-work-scope.js";
import type {
  PrivateBriefingSnapshot,
  PrivateBriefingSource,
} from "../domain/private-briefing.js";
import type { TaskStatus } from "../domain/work-context.js";
import type { WorkStatusSource } from "../domain/work-status.js";
import type { WatchedProjectMonitorState } from "../domain/watched-project.js";

interface ProjectMonitorReader {
  list(): readonly WatchedProjectMonitorState[];
}

interface PendingApprovalReader {
  listProposals(input: {
    readonly actorId: string;
    readonly workspaceId: string;
    readonly status: "pending";
    readonly limit: number;
  }): readonly ActionProposal[];
}

const ATTENTION_STATUSES = new Set<TaskStatus>([
  "approval_needed",
  "failed",
  "retryable",
]);

export class CanonicalPrivateBriefingSource implements PrivateBriefingSource {
  constructor(
    private readonly work: WorkStatusSource,
    private readonly projects: ProjectMonitorReader,
    private readonly approvals: PendingApprovalReader,
    private readonly now: () => Date = () => new Date(),
  ) {}

  snapshot(scope: PrivateWorkScope): PrivateBriefingSnapshot {
    const work = this.work.review({ ...scope, limit: 20 });
    const projectStates = this.projects.list();
    const workflowStatusCounts: Record<PersonalWorkflowStatus, number> = {
      active: 0,
      awaiting_review: 0,
      completed: 0,
      cancelled: 0,
    };
    for (const task of work.tasks) {
      for (const workflow of task.workflows) {
        workflowStatusCounts[workflow.status] += 1;
      }
    }
    const taskItem = (task: typeof work.tasks[number]) => ({
      title: boundedText(task.title),
      status: task.status,
    });
    const projects = projectStates
      .map((state) => {
        const snapshot = state.history.find(
          (run) => run.status === "succeeded" && run.snapshot,
        )?.snapshot;
        return snapshot
          ? { label: boundedText(snapshot.label), alerts: [...snapshot.alerts].sort() }
          : null;
      })
      .filter((project): project is NonNullable<typeof project> => Boolean(project))
      .sort((left, right) => left.label.localeCompare(right.label))
      .slice(0, 10);
    const approvals = this.approvals.listProposals({
      ...scope,
      status: "pending",
      limit: 200,
    });
    return {
      generatedAt: this.now().toISOString(),
      taskStatusCounts: work.statusCounts,
      attentionTasks: work.tasks.filter((task) => ATTENTION_STATUSES.has(task.status))
        .slice(0, 5).map(taskItem),
      activeTasks: work.tasks.filter((task) => task.status === "running")
        .slice(0, 5).map(taskItem),
      workflowStatusCounts,
      projects,
      pendingActionApprovalCount: approvals.length,
      truncated: work.truncated || approvals.length === 200 || projectStates.length > 10,
    };
  }
}

function boundedText(value: string): string {
  const normalized = value.replaceAll(/[\u0000-\u001F\u007F]/g, " ")
    .replaceAll(/\s+/g, " ").trim();
  return normalized.length <= 120 ? normalized : `${normalized.slice(0, 119).trimEnd()}…`;
}
