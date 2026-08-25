import { z } from "zod";

import {
  listPersonalWorkflowTemplates,
  type PersonalWorkflowDetail,
  type PersonalWorkflowStatus,
  type PersonalWorkflowStore,
  type PersonalWorkflowTemplate,
  type PersonalWorkflow,
} from "../domain/personal-workflow.js";
import type { WorkTaskReader } from "../domain/work-context.js";

const identityFields = {
  actorId: z.string().trim().min(1).max(120),
  workspaceId: z.string().trim().min(1).max(120),
};

const workflowKindSchema = z.enum([
  "research",
  "project_planning",
  "drafting",
  "repository_work",
  "briefing",
  "follow_up_preparation",
]);

const workflowStatusSchema = z.enum([
  "active",
  "awaiting_review",
  "completed",
  "cancelled",
]);

const startSchema = z.object({
  ...identityFields,
  taskId: z.string().uuid(),
  kind: workflowKindSchema,
});

const getSchema = z.object({
  ...identityFields,
  id: z.string().uuid(),
});

const listSchema = z.object({
  ...identityFields,
  taskId: z.string().uuid().optional(),
  status: workflowStatusSchema.optional(),
});

const completeStepSchema = z.object({
  ...identityFields,
  id: z.string().uuid(),
  stepId: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(8_000),
});

const reviewSchema = z.object({
  ...identityFields,
  id: z.string().uuid(),
  decision: z.enum(["approved", "changes_requested", "cancelled"]),
  feedback: z.string().trim().max(8_000).default(""),
  returnToStepId: z.string().trim().min(1).max(120).nullable().default(null),
}).superRefine((review, context) => {
  if (review.decision === "changes_requested" && !review.feedback) {
    context.addIssue({
      code: "custom",
      path: ["feedback"],
      message: "Changes requested must include review feedback.",
    });
  }
  if (review.decision === "changes_requested" && !review.returnToStepId) {
    context.addIssue({
      code: "custom",
      path: ["returnToStepId"],
      message: "Changes requested must identify the step to revisit.",
    });
  }
  if (review.decision !== "changes_requested" && review.returnToStepId) {
    context.addIssue({
      code: "custom",
      path: ["returnToStepId"],
      message: "Only changes requested may select a return step.",
    });
  }
});

export class PersonalWorkflowService {
  constructor(
    private readonly store: PersonalWorkflowStore,
    private readonly tasks: WorkTaskReader,
  ) {}

  listTemplates(): readonly PersonalWorkflowTemplate[] {
    return listPersonalWorkflowTemplates();
  }

  start(input: unknown): PersonalWorkflowDetail {
    const request = startSchema.parse(input);
    this.tasks.getTask(request.taskId, request.actorId, request.workspaceId);
    return this.store.start(request);
  }

  get(input: unknown): PersonalWorkflowDetail {
    const request = getSchema.parse(input);
    return this.store.get(request.id, request.actorId, request.workspaceId);
  }

  list(input: unknown): readonly PersonalWorkflow[] {
    const request = listSchema.parse(input);
    return this.store.list(request as {
      actorId: string;
      workspaceId: string;
      taskId?: string;
      status?: PersonalWorkflowStatus;
    });
  }

  completeStep(input: unknown): PersonalWorkflowDetail {
    return this.store.completeStep(completeStepSchema.parse(input));
  }

  review(input: unknown): PersonalWorkflowDetail {
    return this.store.review(reviewSchema.parse(input));
  }
}
