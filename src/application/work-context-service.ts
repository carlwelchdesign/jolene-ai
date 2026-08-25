import { z } from "zod";

import {
  memoryDecisionSchema,
  memoryKindSchema,
  taskStatusSchema,
  type MemoryProposal,
  type WorkContextStore,
  type WorkTask,
} from "../domain/work-context.js";

const identityFields = {
  actorId: z.string().trim().min(1).max(120),
  workspaceId: z.string().trim().min(1).max(120),
};

export const createTaskSchema = z.object({
  ...identityFields,
  title: z.string().trim().min(1).max(240),
  objective: z.string().trim().min(1).max(8_000),
});

export const updateTaskStatusSchema = z.object({
  ...identityFields,
  id: z.string().uuid(),
  status: taskStatusSchema,
});

export const listTasksSchema = z.object({
  ...identityFields,
  status: taskStatusSchema.optional(),
});

export const proposeMemorySchema = z.object({
  ...identityFields,
  taskId: z.string().uuid().nullable().default(null),
  kind: memoryKindSchema,
  content: z.string().trim().min(1).max(4_000),
  source: z.string().trim().min(1).max(1_000),
});

export const decideMemorySchema = z.object({
  ...identityFields,
  id: z.string().uuid(),
  decision: memoryDecisionSchema,
});

export const listMemoryProposalsSchema = z.object({
  ...identityFields,
  status: z.enum(["pending", "approved", "rejected"]).optional(),
});

export class WorkContextService {
  constructor(private readonly store: WorkContextStore) {}

  createTask(input: unknown): WorkTask {
    return this.store.createTask(createTaskSchema.parse(input));
  }

  updateTaskStatus(input: unknown): WorkTask {
    return this.store.updateTaskStatus(updateTaskStatusSchema.parse(input));
  }

  listTasks(input: unknown): readonly WorkTask[] {
    const request = listTasksSchema.parse(input);
    return this.store.listTasks(
      request.actorId,
      request.workspaceId,
      request.status,
    );
  }

  proposeMemory(input: unknown): MemoryProposal {
    return this.store.proposeMemory(proposeMemorySchema.parse(input));
  }

  decideMemory(input: unknown): MemoryProposal {
    return this.store.decideMemory(decideMemorySchema.parse(input));
  }

  listMemoryProposals(input: unknown): readonly MemoryProposal[] {
    const request = listMemoryProposalsSchema.parse(input);
    return this.store.listMemoryProposals(
      request.actorId,
      request.workspaceId,
      request.status,
    );
  }
}
