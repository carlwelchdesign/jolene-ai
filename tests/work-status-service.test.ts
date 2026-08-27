import { describe, expect, it } from "vitest";

import { WorkStatusService } from "../src/application/work-status-service.js";
import type {
  ListPersonalWorkflowsInput,
  PersonalWorkflow,
  PersonalWorkflowReader,
} from "../src/domain/personal-workflow.js";
import type {
  TaskStatus,
  WorkTask,
  WorkTaskDirectory,
} from "../src/domain/work-context.js";

describe("WorkStatusService", () => {
  it("returns scoped, filtered tasks with workflow status and full counts", () => {
    const tasks = new TaskDirectory([
      task("running", "running", "Run the verified implementation."),
      task("approval", "approval_needed", "Review the completed packet."),
      task("foreign", "failed", "Do not cross scope.", "other"),
    ]);
    const workflows = new WorkflowDirectory([
      workflow("workflow-running", "running", "active", "verify"),
      workflow("workflow-foreign", "foreign", "active", "scope"),
    ]);
    const service = new WorkStatusService(tasks, workflows);

    const result = service.review({
      actorId: "carl",
      workspaceId: "personal",
      statuses: ["running", "approval_needed"],
      limit: 10,
    });

    expect(result).toMatchObject({
      totalTaskCount: 2,
      matchingTaskCount: 2,
      returnedTaskCount: 2,
      truncated: false,
      statusCounts: { running: 1, approval_needed: 1, failed: 0 },
    });
    expect(result.tasks).toMatchObject([
      {
        id: "running",
        status: "running",
        workflows: [{ id: "workflow-running", currentStepId: "verify" }],
      },
      {
        id: "approval",
        status: "approval_needed",
        workflows: [],
      },
    ]);
  });

  it("bounds output, reports truncation, and labels clipped objectives", () => {
    const service = new WorkStatusService(
      new TaskDirectory([
        task("one", "pending", "x".repeat(900)),
        task("two", "pending", "Second task."),
      ]),
      new WorkflowDirectory([]),
    );

    const result = service.review({
      actorId: "carl",
      workspaceId: "personal",
      limit: 1,
    });

    expect(result).toMatchObject({
      totalTaskCount: 2,
      matchingTaskCount: 2,
      returnedTaskCount: 1,
      truncated: true,
    });
    expect(result.tasks[0]?.objective).toHaveLength(800);
    expect(result.tasks[0]?.objective.endsWith("…")).toBe(true);
    expect(result.tasks[0]?.objectiveTruncated).toBe(true);
  });

  it("returns an explicit empty snapshot", () => {
    const result = new WorkStatusService(
      new TaskDirectory([]),
      new WorkflowDirectory([]),
    ).review({ actorId: "carl", workspaceId: "personal", limit: 10 });

    expect(result).toMatchObject({
      totalTaskCount: 0,
      matchingTaskCount: 0,
      returnedTaskCount: 0,
      truncated: false,
      tasks: [],
    });
    expect(
      Object.values(result.statusCounts).every((count) => count === 0),
    ).toBe(true);
  });
});

class TaskDirectory implements WorkTaskDirectory {
  constructor(private readonly tasks: readonly WorkTask[]) {}

  listTasks(
    actorId: string,
    workspaceId: string,
    status: TaskStatus | undefined,
  ): readonly WorkTask[] {
    return this.tasks.filter((task) =>
      task.actorId === actorId &&
      task.workspaceId === workspaceId &&
      (!status || task.status === status)
    );
  }
}

class WorkflowDirectory implements PersonalWorkflowReader {
  constructor(private readonly workflows: readonly PersonalWorkflow[]) {}

  list(input: ListPersonalWorkflowsInput): readonly PersonalWorkflow[] {
    return this.workflows.filter((workflow) =>
      workflow.actorId === input.actorId &&
      workflow.workspaceId === input.workspaceId &&
      (!input.taskId || workflow.taskId === input.taskId) &&
      (!input.status || workflow.status === input.status)
    );
  }
}

function task(
  id: string,
  status: TaskStatus,
  objective: string,
  actorId = "carl",
): WorkTask {
  return {
    id,
    actorId,
    workspaceId: "personal",
    title: `Task ${id}`,
    objective,
    status,
    createdAt: "2026-08-25T00:00:00.000Z",
    updatedAt: "2026-08-26T00:00:00.000Z",
  };
}

function workflow(
  id: string,
  taskId: string,
  status: PersonalWorkflow["status"],
  currentStepId: string | null,
): PersonalWorkflow {
  return {
    id,
    actorId: taskId === "foreign" ? "other" : "carl",
    workspaceId: "personal",
    taskId,
    kind: "repository_work",
    status,
    currentStepId,
    createdAt: "2026-08-25T00:00:00.000Z",
    updatedAt: "2026-08-26T00:00:00.000Z",
    completedAt: null,
  };
}
