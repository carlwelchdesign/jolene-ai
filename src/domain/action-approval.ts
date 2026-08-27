import { createHash } from "node:crypto";

import type { ChannelKind } from "./conversation.js";
import type {
  CapabilityDataClass,
  CapabilityId,
} from "./capability-registry.js";
import type { CapabilityRisk } from "./policy.js";

export type ActionDataClass = CapabilityDataClass;
export type ActionDestinationKind = "slack_user" | "slack_channel" | "client_ai";
export type ActionDecision = "approved" | "rejected";
export type ActionProposalStatus =
  | "pending"
  | ActionDecision
  | "expired"
  | "consumed";

export interface ExactExternalAction {
  readonly capabilityId: CapabilityId;
  readonly taskId: string | null;
  readonly destinationKind: ActionDestinationKind;
  readonly destinationId: string;
  readonly content: string;
  readonly dataClass: ActionDataClass;
  readonly purpose: string;
}

export interface ActionProposal extends ExactExternalAction {
  readonly id: string;
  readonly actorId: string;
  readonly workspaceId: string;
  readonly originChannelKind: ChannelKind;
  readonly effectiveRisk: CapabilityRisk;
  readonly payloadFingerprint: string;
  readonly status: ActionProposalStatus;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly decidedAt: string | null;
  readonly consumedAt: string | null;
}

export interface CreateActionProposalInput extends ExactExternalAction {
  readonly actorId: string;
  readonly workspaceId: string;
  readonly originChannelKind: ChannelKind;
  readonly expiresAt: string;
}

export interface DecideActionProposalInput {
  readonly id: string;
  readonly actorId: string;
  readonly workspaceId: string;
  readonly decision: ActionDecision;
}

export interface ListActionProposalsInput {
  readonly actorId: string;
  readonly workspaceId: string;
  readonly status?: ActionProposalStatus;
  readonly limit: number;
}

export interface ClaimApprovedActionInput extends ExactExternalAction {
  readonly proposalId: string;
  readonly actorId: string;
  readonly workspaceId: string;
  readonly requestId: string;
}

export interface ApprovedAction {
  readonly id: string;
  readonly proposalId: string;
  readonly requestId: string;
  readonly actorId: string;
  readonly workspaceId: string;
  readonly payloadFingerprint: string;
  readonly claimedAt: string;
}

export interface ActionApprovalStore {
  createProposal(input: CreateActionProposalInput): ActionProposal;
  decideProposal(input: DecideActionProposalInput): ActionProposal;
  listProposals(input: ListActionProposalsInput): readonly ActionProposal[];
  claimApprovedAction(input: ClaimApprovedActionInput): ApprovedAction;
  close(): void;
}

export function effectiveActionRisk(dataClass: ActionDataClass): CapabilityRisk {
  return dataClass === "general" ? "external_write" : "sensitive_disclosure";
}

export function fingerprintExternalAction(action: ExactExternalAction): string {
  const canonical = JSON.stringify({
    capabilityId: action.capabilityId,
    taskId: action.taskId,
    destinationKind: action.destinationKind,
    destinationId: action.destinationId,
    content: action.content,
    dataClass: action.dataClass,
    purpose: action.purpose,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export class ActionProposalNotFoundError extends Error {
  constructor() {
    super("The action proposal does not exist in this actor and workspace scope.");
    this.name = "ActionProposalNotFoundError";
  }
}

export class ActionProposalConflictError extends Error {
  constructor(message = "The action proposal cannot accept that transition.") {
    super(message);
    this.name = "ActionProposalConflictError";
  }
}

export class ActionApprovalExpiredError extends Error {
  constructor() {
    super("The exact action approval has expired.");
    this.name = "ActionApprovalExpiredError";
  }
}

export class ActionPayloadMismatchError extends Error {
  constructor() {
    super("The requested external action does not match the approved payload.");
    this.name = "ActionPayloadMismatchError";
  }
}
