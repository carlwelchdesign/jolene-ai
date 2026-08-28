import type { CapabilityId } from "./capability-registry.js";
import type { ToolAuthorizationDenialReason } from
  "./tool-call-authorization.js";

export type CapabilityInvocationOutcome = "completed" | "failed";
export type CapabilityAuthorizationOutcome = "allowed" | "denied";

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

export interface CapabilityAuthorizationRecord {
  readonly id: string;
  readonly eventId: string;
  readonly actorId: string;
  readonly workspaceId: string;
  readonly capabilityId: CapabilityId;
  readonly toolName: string;
  readonly outcome: CapabilityAuthorizationOutcome;
  readonly reasonCode: ToolAuthorizationDenialReason | null;
  readonly authorizationId: string | null;
  readonly argumentsFingerprint: string | null;
  readonly createdAt: string;
}

export interface RecordCapabilityAuthorizationInput {
  readonly eventId: string;
  readonly actorId: string;
  readonly workspaceId: string;
  readonly capabilityId: CapabilityId;
  readonly toolName: string;
  readonly outcome: CapabilityAuthorizationOutcome;
  readonly reasonCode: ToolAuthorizationDenialReason | null;
  readonly authorizationId: string | null;
  readonly argumentsFingerprint: string | null;
}

export interface ListCapabilityInvocationsInput {
  readonly actorId: string;
  readonly workspaceId: string;
  readonly eventId?: string;
  readonly limit: number;
}

export interface CapabilityInvocationStore {
  recordAuthorization(
    input: RecordCapabilityAuthorizationInput,
  ): CapabilityAuthorizationRecord;
  recordInvocation(
    input: RecordCapabilityInvocationInput,
  ): CapabilityInvocationRecord;
  listInvocations(
    input: ListCapabilityInvocationsInput,
  ): readonly CapabilityInvocationRecord[];
  listAuthorizations(
    input: ListCapabilityInvocationsInput,
  ): readonly CapabilityAuthorizationRecord[];
  close(): void;
}
