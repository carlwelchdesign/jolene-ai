import type { PersonalWorkflowReader } from "../domain/personal-workflow.js";
import {
  taskStatusSchema,
  type TaskStatus,
  type WorkTaskDirectory,
} from "../domain/work-context.js";
import type {
  ReviewWorkStatusInput,
  WorkStatusSnapshot,
  WorkStatusSource,
} from "../domain/work-status.js";

const OBJECTIVE_LIMIT = 800;

export class WorkStatusService implements WorkStatusSource {
  constructor(
    private readonly tasks: WorkTaskDirectory,
    private readonly workflows: PersonalWorkflowReader,
  ) {}

  review(input: ReviewWorkStatusInput): WorkStatusSnapshot {
    const limit = Math.max(1, Math.min(input.limit, 20));
    const allTasks = this.tasks.listTasks(
      input.actorId,
      input.workspaceId,
      undefined,
    );
    const requestedStatuses = input.statuses && input.statuses.length > 0
      ? new Set(input.statuses)
      : null;
    const matchingTasks = requestedStatuses
      ? allTasks.filter((task) => requestedStatuses.has(task.status))
      : allTasks;
    const selectedTasks = matchingTasks.slice(0, limit);
    const workflowsByTask = new Map<
      string,
      ReturnType<PersonalWorkflowReader["list"]>
    >();
    for (const task of selectedTasks) {
      workflowsByTask.set(task.id, this.workflows.list({
        actorId: input.actorId,
        workspaceId: input.workspaceId,
        taskId: task.id,
      }));
    }

    return {
      totalTaskCount: allTasks.length,
      matchingTaskCount: matchingTasks.length,
      returnedTaskCount: selectedTasks.length,
      truncated: matchingTasks.length > selectedTasks.length,
      statusCounts: countStatuses(allTasks.map((task) => task.status)),
      tasks: selectedTasks.map((task) => {
        const objective = clip(task.objective, OBJECTIVE_LIMIT);
        return {
          id: task.id,
          title: task.title,
          objective: objective.value,
          objectiveTruncated: objective.truncated,
          status: task.status,
          updatedAt: task.updatedAt,
          workflows: (workflowsByTask.get(task.id) ?? []).map((workflow) => ({
            id: workflow.id,
            kind: workflow.kind,
            status: workflow.status,
            currentStepId: workflow.currentStepId,
            updatedAt: workflow.updatedAt,
          })),
        };
      }),
    };
  }
}

function countStatuses(
  statuses: readonly TaskStatus[],
): Record<TaskStatus, number> {
  const counts = Object.fromEntries(
    taskStatusSchema.options.map((status) => [status, 0]),
  ) as Record<TaskStatus, number>;
  for (const status of statuses) counts[status] += 1;
  return counts;
}

function clip(value: string, limit: number): {
  readonly value: string;
  readonly truncated: boolean;
} {
  if (value.length <= limit) return { value, truncated: false };
  return { value: value.slice(0, limit - 1).trimEnd() + "…", truncated: true };
}
