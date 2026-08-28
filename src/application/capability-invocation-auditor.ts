import {
  requireModelCapability,
  type CapabilityId,
} from "../domain/capability-registry.js";
import type { ChannelKind } from "../domain/conversation.js";
import type { CapabilityInvocationStore } from
  "../domain/capability-invocation.js";
import {
  IntentBoundToolAuthorizer,
  ToolCallAuthorizationDeniedError,
  type ToolCallAuthorizationPermit,
} from "../domain/tool-call-authorization.js";

export interface CapabilityInvocationContext {
  readonly eventId: string;
  readonly actorId: string;
  readonly workspaceId: string;
  readonly channelKind: ChannelKind;
}

export class CapabilityInvocationAuditor {
  constructor(private readonly store: CapabilityInvocationStore) {}

  async execute<Output>(
    capabilityId: CapabilityId,
    context: CapabilityInvocationContext,
    operation: () => Promise<Output> | Output,
  ): Promise<Output> {
    const capability = requireModelCapability(
      capabilityId,
      context.channelKind,
    );
    const output = await operation();
    this.recordOrThrow({
      eventId: context.eventId,
      actorId: context.actorId,
      workspaceId: context.workspaceId,
      capabilityId,
      toolName: capability.modelToolName,
      outcome: "completed",
    });
    return output;
  }

  authorize(
    capabilityId: CapabilityId,
    context: CapabilityInvocationContext,
    authorizer: IntentBoundToolAuthorizer,
    args: unknown,
    now: string,
  ): ToolCallAuthorizationPermit {
    const capability = requireModelCapability(
      capabilityId,
      context.channelKind,
    );
    try {
      const permit = authorizer.authorize(capabilityId, args, now);
      this.recordAuthorizationOrThrow({
        eventId: context.eventId,
        actorId: context.actorId,
        workspaceId: context.workspaceId,
        capabilityId,
        toolName: capability.modelToolName,
        outcome: "allowed",
        reasonCode: null,
        authorizationId: permit.authorizationId,
        argumentsFingerprint: permit.argumentsFingerprint,
      });
      return permit;
    } catch (error) {
      if (error instanceof ToolCallAuthorizationDeniedError) {
        this.recordAuthorizationOrThrow({
          eventId: context.eventId,
          actorId: context.actorId,
          workspaceId: context.workspaceId,
          capabilityId,
          toolName: capability.modelToolName,
          outcome: "denied",
          reasonCode: error.reasonCode,
          authorizationId: authorizer.authorization.authorizationId,
          argumentsFingerprint: null,
        });
      }
      throw error;
    }
  }

  recordArgumentRejection(
    capabilityId: CapabilityId,
    context: CapabilityInvocationContext,
  ): void {
    const capability = requireModelCapability(capabilityId, context.channelKind);
    this.recordAuthorizationOrThrow({
      eventId: context.eventId,
      actorId: context.actorId,
      workspaceId: context.workspaceId,
      capabilityId,
      toolName: capability.modelToolName,
      outcome: "denied",
      reasonCode: "argument_invalid",
      authorizationId: null,
      argumentsFingerprint: null,
    });
  }

  recordFailure(
    capabilityId: CapabilityId,
    context: CapabilityInvocationContext,
  ): void {
    const capability = requireModelCapability(
      capabilityId,
      context.channelKind,
    );
    this.recordOrThrow({
      eventId: context.eventId,
      actorId: context.actorId,
      workspaceId: context.workspaceId,
      capabilityId,
      toolName: capability.modelToolName,
      outcome: "failed",
    });
  }

  private recordOrThrow(input: Parameters<
    CapabilityInvocationStore["recordInvocation"]
  >[0]): void {
    try {
      this.store.recordInvocation(input);
    } catch {
      throw new CapabilityInvocationAuditUnavailableError();
    }
  }

  private recordAuthorizationOrThrow(input: Parameters<
    CapabilityInvocationStore["recordAuthorization"]
  >[0]): void {
    try {
      this.store.recordAuthorization(input);
    } catch {
      throw new CapabilityInvocationAuditUnavailableError();
    }
  }
}

export class CapabilityInvocationAuditUnavailableError extends Error {
  constructor() {
    super("The capability audit ledger is unavailable.");
    this.name = "CapabilityInvocationAuditUnavailableError";
  }
}
