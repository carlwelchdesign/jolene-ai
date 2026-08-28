import { z } from "zod";

import {
  effectiveActionRisk,
  type ActionApprovalStore,
  type ActionProposal,
  type ApprovedAction,
} from "../domain/action-approval.js";
import { requireCapability } from "../domain/capability-registry.js";
import { channelKindSchema } from "../domain/conversation.js";
import { evaluatePolicy, isPrivateChannel } from "../domain/policy.js";
import type { WorkTaskReader } from "../domain/work-context.js";

const capabilityIdSchema = z.literal("external_message.send");
const destinationKindSchema = z.enum(["slack_user", "slack_channel", "client_ai"]);
const dataClassSchema = z.enum(["general", "private", "restricted", "sensitive"]);
const actionStatusSchema = z.enum([
  "pending",
  "approved",
  "rejected",
  "expired",
  "consumed",
]);

const identityFields = {
  actorId: z.string().trim().min(1).max(120),
  workspaceId: z.string().trim().min(1).max(120),
};

const exactActionFields = {
  capabilityId: capabilityIdSchema,
  taskId: z.string().uuid().nullable().default(null),
  destinationKind: destinationKindSchema,
  destinationId: z.string().trim().min(1).max(240),
  content: z.string().trim().min(1).max(40_000),
  dataClass: dataClassSchema,
  purpose: z.string().trim().min(1).max(1_000),
};

const createProposalSchema = z.object({
  ...identityFields,
  ...exactActionFields,
  originChannelKind: channelKindSchema,
  expiresAt: z.string().datetime({ offset: true }),
});

const decideProposalSchema = z.object({
  ...identityFields,
  id: z.string().uuid(),
  decision: z.enum(["approved", "rejected"]),
  payloadFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  authority: z.object({
    source: z.literal("authenticated_owner_review_ui"),
    authority: z.literal("user"),
    taintIds: z.array(z.never()).length(0),
    derivationIds: z.array(z.never()).length(0),
  }).strict(),
}).strict();

const listProposalsSchema = z.object({
  ...identityFields,
  status: actionStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const claimActionSchema = z.object({
  ...identityFields,
  ...exactActionFields,
  proposalId: z.string().uuid(),
  requestId: z.string().trim().min(1).max(240),
});

const MAX_APPROVAL_LIFETIME_MS = 24 * 60 * 60 * 1_000;

export class ActionApprovalService {
  constructor(
    private readonly store: ActionApprovalStore,
    private readonly tasks: WorkTaskReader,
    private readonly now: () => Date = () => new Date(),
  ) {}

  createProposal(input: unknown): ActionProposal {
    const request = createProposalSchema.parse(input);
    requireCapability(request.capabilityId);
    if (!isPrivateChannel(request.originChannelKind)) {
      throw new ActionProposalPolicyError(
        "External actions may be proposed only from a private context.",
      );
    }
    const risk = effectiveActionRisk(request.dataClass);
    if (evaluatePolicy({
      risk,
      channelKind: request.originChannelKind,
      explicitlyRequested: true,
    }).outcome !== "approval_required") {
      throw new ActionProposalPolicyError(
        "The capability registry did not require exact approval.",
      );
    }
    if (
      (request.dataClass === "restricted" || request.dataClass === "sensitive") &&
      !request.taskId
    ) {
      throw new ActionProposalPolicyError(
        "Restricted and sensitive disclosures must be bound to a task.",
      );
    }
    if (request.taskId) {
      this.tasks.getTask(request.taskId, request.actorId, request.workspaceId);
    }
    const expiresAt = new Date(request.expiresAt);
    const lifetime = expiresAt.valueOf() - this.now().valueOf();
    if (lifetime <= 0 || lifetime > MAX_APPROVAL_LIFETIME_MS) {
      throw new ActionProposalPolicyError(
        "Action proposals must expire within the next 24 hours.",
      );
    }

    return this.store.createProposal({
      ...request,
      expiresAt: expiresAt.toISOString(),
    });
  }

  decideProposal(input: unknown): ActionProposal {
    return this.store.decideProposal(decideProposalSchema.parse(input));
  }

  listProposals(input: unknown): readonly ActionProposal[] {
    const request = listProposalsSchema.parse(input);
    return this.store.listProposals({
      actorId: request.actorId,
      workspaceId: request.workspaceId,
      limit: request.limit,
      ...(request.status ? { status: request.status } : {}),
    });
  }

  claimApprovedAction(input: unknown): ApprovedAction {
    return this.store.claimApprovedAction(claimActionSchema.parse(input));
  }
}

export class ActionProposalPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActionProposalPolicyError";
  }
}
