import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { PersonalWorkflowService } from "../src/application/personal-workflow-service.js";
import { WorkContextService } from "../src/application/work-context-service.js";
import {
  PersonalWorkflowConflictError,
  PersonalWorkflowNotFoundError,
} from "../src/domain/personal-workflow.js";
import { SqlitePersonalWorkflowStore } from "../src/persistence/sqlite-personal-workflow-store.js";
import { SqliteWorkContextStore } from "../src/persistence/sqlite-work-context-store.js";

const identity = { actorId: "carl", workspaceId: "personal" } as const;

describe("personal work workflows", () => {
  it("takes every supported workflow through durable evidence and human approval", () => {
    const fixture = createFixture(":memory:");

    try {
      const templates = fixture.service.listTemplates();
      expect(templates.map((template) => template.kind)).toEqual([
        "research",
        "project_planning",
        "drafting",
        "repository_work",
        "briefing",
        "follow_up_preparation",
      ]);

      for (const template of templates) {
        const task = fixture.work.createTask({
          ...identity,
          title: `${template.label} fixture`,
          objective: `Verify the ${template.kind} workflow.`,
        });
        let detail = fixture.service.start({
          ...identity,
          taskId: task.id,
          kind: template.kind,
        });
        expect(detail.workflow).toMatchObject({
          taskId: task.id,
          kind: template.kind,
          status: "active",
          currentStepId: template.steps[0]?.id,
        });

        for (const step of template.steps) {
          detail = fixture.service.completeStep({
            ...identity,
            id: detail.workflow.id,
            stepId: step.id,
            summary: `Evidence recorded for ${step.label}.`,
          });
        }

        expect(detail.workflow).toMatchObject({
          status: "awaiting_review",
          currentStepId: null,
        });
        expect(detail.events.map((event) => event.type)).toEqual([
          "started",
          ...template.steps.map(() => "step_completed"),
          "submitted_for_review",
        ]);

        detail = fixture.service.review({
          ...identity,
          id: detail.workflow.id,
          decision: "approved",
          feedback: "Reviewed by Carl.",
        });
        expect(detail.workflow).toMatchObject({
          status: "completed",
          currentStepId: null,
        });
        expect(detail.workflow.completedAt).not.toBeNull();
        expect(detail.events.at(-1)).toMatchObject({
          type: "approved",
          summary: "Reviewed by Carl.",
        });
      }
    } finally {
      fixture.close();
    }
  });

  it("requires exact current-step evidence and supports a bounded revision loop", () => {
    const fixture = createFixture(":memory:");

    try {
      const task = fixture.work.createTask({
        ...identity,
        title: "Prepare a repository change",
        objective: "Exercise exact step transitions.",
      });
      let detail = fixture.service.start({
        ...identity,
        taskId: task.id,
        kind: "repository_work",
      });

      expect(() => fixture.service.start({
        ...identity,
        taskId: task.id,
        kind: "repository_work",
      })).toThrow(PersonalWorkflowConflictError);
      expect(() => fixture.service.completeStep({
        ...identity,
        id: detail.workflow.id,
        stepId: "verify",
        summary: "Skipped ahead.",
      })).toThrow(PersonalWorkflowConflictError);
      expect(() => fixture.service.review({
        ...identity,
        id: detail.workflow.id,
        decision: "approved",
      })).toThrow(PersonalWorkflowConflictError);

      for (const step of detail.template.steps) {
        detail = fixture.service.completeStep({
          ...identity,
          id: detail.workflow.id,
          stepId: step.id,
          summary: `${step.label} complete.`,
        });
      }
      detail = fixture.service.review({
        ...identity,
        id: detail.workflow.id,
        decision: "changes_requested",
        feedback: "Repeat verification with the full suite.",
        returnToStepId: "verify",
      });
      expect(detail.workflow).toMatchObject({
        status: "active",
        currentStepId: "verify",
      });

      detail = fixture.service.completeStep({
        ...identity,
        id: detail.workflow.id,
        stepId: "verify",
        summary: "Full suite passed.",
      });
      detail = fixture.service.completeStep({
        ...identity,
        id: detail.workflow.id,
        stepId: "review_packet",
        summary: "Updated evidence is ready.",
      });
      expect(detail.workflow.status).toBe("awaiting_review");
      expect(detail.events.filter((event) => event.type === "submitted_for_review"))
        .toHaveLength(2);
    } finally {
      fixture.close();
    }
  });

  it("isolates actor scope and persists an awaiting-review run across restart", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "jolene-workflow-"));
    const databasePath = path.join(root, "jolene.sqlite");

    try {
      const first = createFixture(databasePath);
      const task = first.work.createTask({
        ...identity,
        title: "Persistent briefing",
        objective: "Survive restart without losing evidence.",
      });
      let detail = first.service.start({
        ...identity,
        taskId: task.id,
        kind: "briefing",
      });
      for (const step of detail.template.steps) {
        detail = first.service.completeStep({
          ...identity,
          id: detail.workflow.id,
          stepId: step.id,
          summary: `${step.label} complete.`,
        });
      }
      const workflowId = detail.workflow.id;
      first.close();

      const second = createFixture(databasePath);
      try {
        expect(second.service.get({ ...identity, id: workflowId }).workflow.status)
          .toBe("awaiting_review");
        expect(() => second.service.get({
          actorId: "someone-else",
          workspaceId: "personal",
          id: workflowId,
        })).toThrow(PersonalWorkflowNotFoundError);
        expect(second.service.list({ ...identity, taskId: task.id })).toMatchObject([
          { id: workflowId, status: "awaiting_review" },
        ]);
      } finally {
        second.close();
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

function createFixture(databasePath: string) {
  const workStore = new SqliteWorkContextStore(databasePath);
  const workflowStore = new SqlitePersonalWorkflowStore(databasePath);
  return {
    work: new WorkContextService(workStore),
    service: new PersonalWorkflowService(workflowStore, workStore),
    close: () => {
      workflowStore.close();
      workStore.close();
    },
  };
}
