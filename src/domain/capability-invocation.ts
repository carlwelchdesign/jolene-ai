import type { CapabilityId } from "./capability-registry.js";

export type CapabilityInvocationOutcome = "completed" | "failed";

export interface CapabilityInvocationRecord {
  readonly id: string;
  readonly eventId: string;
  readonly actorId: string;
  readonly workspaceId: string;
  readonly capabilityId: CapabilityId;
  readonly toolName: string;
  readonly outcome: CapabilityInvocationOutcome;
  readonly createdAt: string;
}

export interface RecordCapabilityInvocationInput {
  readonly eventId: string;
  readonly actorId: string;
  readonly workspaceId: string;
  readonly capabilityId: CapabilityId;
  readonly toolName: string;
  readonly outcome: CapabilityInvocationOutcome;
}

export interface ListCapabilityInvocationsInput {
  readonly actorId: string;
  readonly workspaceId: string;
  readonly eventId?: string;
  readonly limit: number;
}

export interface CapabilityInvocationStore {
  recordInvocation(
    input: RecordCapabilityInvocationInput,
  ): CapabilityInvocationRecord;
  listInvocations(
    input: ListCapabilityInvocationsInput,
  ): readonly CapabilityInvocationRecord[];
  close(): void;
}
