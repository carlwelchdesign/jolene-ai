import { z } from "zod";

export const taskStatusSchema = z.enum([
  "pending",
  "running",
  "approval_needed",
  "failed",
  "retryable",
  "completed",
  "cancelled",
]);

export type TaskStatus = z.infer<typeof taskStatusSchema>;

export const memoryKindSchema = z.enum([
  "preference",
  "project_decision",
  "standing_rule",
  "corrected_fact",
]);

export type MemoryKind = z.infer<typeof memoryKindSchema>;

export const memoryDecisionSchema = z.enum(["approved", "rejected"]);
export type MemoryDecision = z.infer<typeof memoryDecisionSchema>;

export interface WorkTask {
  readonly id: string;
  readonly actorId: string;
  readonly workspaceId: string;
  readonly title: string;
  readonly objective: string;
  readonly status: TaskStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface MemoryProposal {
  readonly id: string;
  readonly actorId: string;
  readonly workspaceId: string;
  readonly taskId: string | null;
  readonly kind: MemoryKind;
  readonly content: string;
  readonly source: string;
  readonly status: "pending" | MemoryDecision;
  readonly createdAt: string;
  readonly decidedAt: string | null;
}

export interface DurableMemory {
  readonly id: string;
  readonly actorId: string;
  readonly workspaceId: string;
  readonly taskId: string | null;
  readonly kind: MemoryKind;
  readonly content: string;
  readonly sourceProposalId: string;
  readonly createdAt: string;
}

export interface AuthorizedWorkContext {
  readonly task: WorkTask | null;
  readonly memories: readonly DurableMemory[];
}

export interface CreateTaskInput {
  readonly actorId: string;
  readonly workspaceId: string;
  readonly title: string;
  readonly objective: string;
}

export interface UpdateTaskStatusInput {
  readonly id: string;
  readonly actorId: string;
  readonly workspaceId: string;
  readonly status: TaskStatus;
}

export interface ProposeMemoryInput {
  readonly actorId: string;
  readonly workspaceId: string;
  readonly taskId: string | null;
  readonly kind: MemoryKind;
  readonly content: string;
  readonly source: string;
}

export interface DecideMemoryInput {
  readonly id: string;
  readonly actorId: string;
  readonly workspaceId: string;
  readonly decision: MemoryDecision;
}

export interface WorkContextReader {
  loadAuthorizedContext(
    actorId: string,
    workspaceId: string,
    taskId: string | undefined,
    memoryLimit: number,
  ): AuthorizedWorkContext;
}

export interface WorkContextStore extends WorkContextReader {
  createTask(input: CreateTaskInput): WorkTask;
  updateTaskStatus(input: UpdateTaskStatusInput): WorkTask;
  listTasks(
    actorId: string,
    workspaceId: string,
    status: TaskStatus | undefined,
  ): readonly WorkTask[];
  proposeMemory(input: ProposeMemoryInput): MemoryProposal;
  decideMemory(input: DecideMemoryInput): MemoryProposal;
  listMemoryProposals(
    actorId: string,
    workspaceId: string,
    status: MemoryProposal["status"] | undefined,
  ): readonly MemoryProposal[];
  close(): void;
}

export class WorkTaskNotFoundError extends Error {
  constructor() {
    super("The requested work task does not exist in this actor and workspace scope.");
    this.name = "WorkTaskNotFoundError";
  }
}

export class MemoryProposalNotFoundError extends Error {
  constructor() {
    super("The requested memory proposal does not exist in this actor and workspace scope.");
    this.name = "MemoryProposalNotFoundError";
  }
}

export class MemoryProposalConflictError extends Error {
  constructor() {
    super("The memory proposal already has a different decision.");
    this.name = "MemoryProposalConflictError";
  }
}
