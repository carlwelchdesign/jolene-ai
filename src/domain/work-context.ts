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

export const taskEventKindSchema = z.enum([
  "created",
  "status_changed",
  "progress",
  "evidence",
  "decision",
  "blocker",
  "next_action",
]);

export type TaskEventKind = z.infer<typeof taskEventKindSchema>;

export const appendableTaskEventKindSchema = z.enum([
  "progress",
  "evidence",
  "decision",
  "blocker",
  "next_action",
]);

export type AppendableTaskEventKind = z.infer<
  typeof appendableTaskEventKindSchema
>;

export const memoryKindSchema = z.enum([
  "preference",
  "project_decision",
  "standing_rule",
  "corrected_fact",
]);

export type MemoryKind = z.infer<typeof memoryKindSchema>;

export const memorySensitivitySchema = z.enum([
  "private",
  "restricted",
  "sensitive",
]);

export type MemorySensitivity = z.infer<typeof memorySensitivitySchema>;

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

export interface TaskEvent {
  readonly id: string;
  readonly taskId: string;
  readonly actorId: string;
  readonly workspaceId: string;
  readonly kind: TaskEventKind;
  readonly summary: string;
  readonly details: string | null;
  readonly fromStatus: TaskStatus | null;
  readonly toStatus: TaskStatus | null;
  readonly createdAt: string;
}

export interface MemoryProposal {
  readonly id: string;
  readonly actorId: string;
  readonly workspaceId: string;
  readonly taskId: string | null;
  readonly kind: MemoryKind;
  readonly content: string;
  readonly source: string;
  readonly sensitivity: MemorySensitivity;
  readonly expiresAt: string | null;
  readonly replacesMemoryId: string | null;
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
  readonly sensitivity: MemorySensitivity;
  readonly expiresAt: string | null;
  readonly sourceProposalId: string;
  readonly createdAt: string;
  readonly state: "active" | "expired" | "superseded" | "forgotten";
  readonly retiredAt: string | null;
}

export interface AuthorizedWorkContext {
  readonly task: WorkTask | null;
  readonly taskEvents: readonly TaskEvent[];
  readonly taskEventSelection?: TaskEventSelectionSummary;
  readonly memories: readonly DurableMemory[];
  readonly selection?: MemorySelectionSummary;
}

export interface TaskEventSelectionEvidence {
  readonly eventId: string;
  readonly score: number;
  readonly matchedTerms: readonly string[];
  readonly reasons: readonly string[];
}

export interface TaskEventSelectionSummary {
  readonly strategy: "deterministic_lexical_v1";
  readonly candidateCount: number;
  readonly recentCount: number;
  readonly queryTerms: readonly string[];
  readonly evidence: readonly TaskEventSelectionEvidence[];
}

export interface MemorySelectionEvidence {
  readonly memoryId: string;
  readonly score: number;
  readonly matchedTerms: readonly string[];
  readonly reasons: readonly string[];
}

export interface MemorySelectionSummary {
  readonly strategy: "deterministic_lexical_v1";
  readonly candidateCount: number;
  readonly queryTerms: readonly string[];
  readonly evidence: readonly MemorySelectionEvidence[];
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

export interface AppendTaskEventInput {
  readonly taskId: string;
  readonly actorId: string;
  readonly workspaceId: string;
  readonly kind: AppendableTaskEventKind;
  readonly summary: string;
  readonly details?: string | null;
}

export interface ProposeMemoryInput {
  readonly actorId: string;
  readonly workspaceId: string;
  readonly taskId: string | null;
  readonly kind: MemoryKind;
  readonly content: string;
  readonly source: string;
  readonly sensitivity?: MemorySensitivity;
  readonly expiresAt?: string | null;
  readonly replacesMemoryId?: string | null;
}

export interface DecideMemoryInput {
  readonly id: string;
  readonly actorId: string;
  readonly workspaceId: string;
  readonly decision: MemoryDecision;
}

export interface ForgetMemoryInput {
  readonly id: string;
  readonly actorId: string;
  readonly workspaceId: string;
}

export interface AuthorizedContextRequest {
  readonly actorId: string;
  readonly workspaceId: string;
  readonly taskId?: string | undefined;
  readonly memoryLimit: number;
  readonly includeSensitiveMemory: boolean;
  readonly query?: string;
  readonly taskEventLimit?: number;
}

export interface WorkContextReader {
  loadAuthorizedContext(
    request: AuthorizedContextRequest,
  ): AuthorizedWorkContext;
}

export interface WorkTaskReader {
  getTask(id: string, actorId: string, workspaceId: string): WorkTask;
}

export interface WorkTaskDirectory {
  listTasks(
    actorId: string,
    workspaceId: string,
    status: TaskStatus | undefined,
  ): readonly WorkTask[];
}

export interface WorkContextStore
extends WorkContextReader, WorkTaskReader, WorkTaskDirectory {
  createTask(input: CreateTaskInput): WorkTask;
  updateTaskStatus(input: UpdateTaskStatusInput): WorkTask;
  appendTaskEvent(input: AppendTaskEventInput): TaskEvent;
  listTaskEvents(
    taskId: string,
    actorId: string,
    workspaceId: string,
    limit: number,
  ): readonly TaskEvent[];
  proposeMemory(input: ProposeMemoryInput): MemoryProposal;
  decideMemory(input: DecideMemoryInput): MemoryProposal;
  listMemoryProposals(
    actorId: string,
    workspaceId: string,
    status: MemoryProposal["status"] | undefined,
  ): readonly MemoryProposal[];
  listMemories(
    actorId: string,
    workspaceId: string,
  ): readonly DurableMemory[];
  forgetMemory(input: ForgetMemoryInput): DurableMemory;
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

export class DurableMemoryNotFoundError extends Error {
  constructor() {
    super(
      "The requested durable memory does not exist in this actor and workspace scope.",
    );
    this.name = "DurableMemoryNotFoundError";
  }
}

export class DurableMemoryConflictError extends Error {
  constructor() {
    super("The requested durable memory is no longer active.");
    this.name = "DurableMemoryConflictError";
  }
}
