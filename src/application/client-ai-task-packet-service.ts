import { z } from "zod";

import {
  ClientAiPacketPayloadMismatchError,
  expectedClientAiOutboundFingerprint,
  listClientAiRecipients,
  type ClientAiTaskPacket,
  type ClientAiTaskPacketStore,
} from "../domain/client-ai-task-packet.js";
import type { ApprovedAction, ClaimApprovedActionInput } from "../domain/action-approval.js";
import type { PrivateWorkScope } from "../domain/private-work-scope.js";
import type { WorkTaskReader } from "../domain/work-context.js";

const recipientIdSchema = z.enum(["jenny", "maria"]);
const contextDataClassSchema = z.enum(["general", "private", "restricted"]);
const contextSourceKindSchema = z.enum([
  "task_context",
  "approved_summary",
  "approved_public_evidence",
  "workflow_state",
]);

const createPacketSchema = z.object({
  taskId: z.string().uuid(),
  recipientId: recipientIdSchema,
  purpose: z.string().trim().min(1).max(1_000),
  contextItems: z.array(z.object({
    label: z.string().trim().min(1).max(120),
    content: z.string().trim().min(1).max(2_000),
    dataClass: contextDataClassSchema,
    sourceKind: contextSourceKindSchema,
  }).strict()).min(1).max(8),
  questions: z.array(z.string().trim().min(1).max(500)).min(1).max(8),
  turnLimit: z.number().int().min(1).max(5),
  expiresAt: z.string().datetime({ offset: true }),
}).strict().superRefine((input, context) => {
  const labels = new Set<string>();
  input.contextItems.forEach((item, index) => {
    const key = item.label.toLowerCase();
    if (labels.has(key)) {
      context.addIssue({
        code: "custom",
        path: ["contextItems", index, "label"],
        message: "Context item labels must be unique inside a packet.",
      });
    }
    labels.add(key);
  });
  if (input.contextItems.reduce((total, item) => total + item.content.length, 0) > 12_000) {
    context.addIssue({
      code: "custom",
      path: ["contextItems"],
      message: "Approved context exceeds the 12,000-character packet budget.",
    });
  }
});

const identifierSchema = z.object({ id: z.string().uuid() }).strict();
const decisionSchema = identifierSchema.extend({
  decision: z.enum(["approved", "rejected"]),
  expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
const listSchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) });

const recordTurnSchema = z.discriminatedUnion("speaker", [
  identifierSchema.extend({
    speaker: z.literal("jolene"),
    senderIdentity: z.literal("jolene"),
    requestId: z.string().trim().min(1).max(240),
    content: z.string().trim().min(1).max(8_000),
    dataClass: contextDataClassSchema,
    proposalId: z.string().uuid(),
  }).strict(),
  identifierSchema.extend({
    speaker: z.literal("external_ai"),
    senderIdentity: z.string().trim().min(1).max(120),
    requestId: z.string().trim().min(1).max(240),
    content: z.string().trim().min(1).max(8_000),
  }).strict(),
]);

const handoffSchema = identifierSchema.extend({
  summary: z.string().trim().min(1).max(4_000),
  decisions: z.array(z.string().trim().min(1).max(500)).max(12),
  unresolvedQuestions: z.array(z.string().trim().min(1).max(500)).max(12),
  proposedNextAction: z.string().trim().min(1).max(1_000),
}).strict();

const handoffReviewSchema = identifierSchema.extend({
  handoffId: z.string().uuid(),
  decision: z.enum(["approved", "changes_requested"]),
  feedback: z.string().trim().max(2_000).default(""),
}).strict().superRefine((input, context) => {
  if (input.decision === "changes_requested" && !input.feedback) {
    context.addIssue({
      code: "custom",
      path: ["feedback"],
      message: "Requested handoff changes require feedback.",
    });
  }
});

const MAX_PACKET_LIFETIME_MS = 24 * 60 * 60 * 1_000;

export class ClientAiTaskPacketService {
  constructor(
    private readonly store: ClientAiTaskPacketStore,
    private readonly tasks: WorkTaskReader,
    private readonly actionApprovals: ActionApprovalClaimer,
    private readonly ownerScope: PrivateWorkScope,
    private readonly now: () => Date = () => new Date(),
  ) {}

  recipients() { return listClientAiRecipients(); }

  scope(): PrivateWorkScope { return { ...this.ownerScope }; }

  create(input: unknown): ClientAiTaskPacket {
    const request = createPacketSchema.parse(input);
    this.tasks.getTask(
      request.taskId,
      this.ownerScope.actorId,
      this.ownerScope.workspaceId,
    );
    const now = this.now();
    const expiresAt = new Date(request.expiresAt);
    const lifetime = expiresAt.valueOf() - now.valueOf();
    if (lifetime <= 0 || lifetime > MAX_PACKET_LIFETIME_MS) {
      throw new ClientAiTaskPacketPolicyError(
        "Client-AI task packets must expire within the next 24 hours.",
      );
    }
    return this.store.create({ ...this.ownerScope, ...request }, now);
  }

  list(input: unknown): readonly ClientAiTaskPacket[] {
    return this.store.list(this.ownerScope, this.now(), listSchema.parse(input).limit);
  }

  get(input: unknown): ClientAiTaskPacket {
    return this.store.get(identifierSchema.parse(input).id, this.ownerScope, this.now());
  }

  decide(input: unknown): ClientAiTaskPacket {
    return this.store.decide(
      { ...this.ownerScope, ...decisionSchema.parse(input) },
      this.now(),
    );
  }

  cancel(input: unknown): ClientAiTaskPacket {
    return this.store.cancel(
      identifierSchema.parse(input).id,
      this.ownerScope,
      this.now(),
    );
  }

  recordTurn(input: unknown): ClientAiTaskPacket {
    const request = recordTurnSchema.parse(input);
    const packet = this.store.get(request.id, this.ownerScope, this.now());
    if (request.speaker === "jolene") {
      const approval = this.actionApprovals.claimApprovedAction({
        ...this.ownerScope,
        proposalId: request.proposalId,
        requestId: request.requestId,
        capabilityId: "external_message.send",
        taskId: packet.taskId,
        destinationKind: "client_ai",
        destinationId: packet.recipient.projectId,
        content: request.content,
        dataClass: request.dataClass,
        purpose: packet.purpose,
      });
      if (
        approval.actorId !== this.ownerScope.actorId ||
        approval.workspaceId !== this.ownerScope.workspaceId ||
        approval.requestId !== request.requestId ||
        approval.payloadFingerprint !== expectedClientAiOutboundFingerprint(
          packet,
          request.content,
          request.dataClass,
        )
      ) {
        throw new ClientAiPacketPayloadMismatchError(
          "The Jolene turn does not match its consumed exact-action approval.",
        );
      }
      return this.store.recordTurn(
        { ...this.ownerScope, ...request, approvedAction: approval },
        this.now(),
      );
    }
    return this.store.recordTurn(
      { ...this.ownerScope, ...request },
      this.now(),
    );
  }

  submitHandoff(input: unknown): ClientAiTaskPacket {
    return this.store.submitHandoff(
      { ...this.ownerScope, ...handoffSchema.parse(input) },
      this.now(),
    );
  }

  reviewHandoff(input: unknown): ClientAiTaskPacket {
    return this.store.reviewHandoff(
      { ...this.ownerScope, ...handoffReviewSchema.parse(input) },
      this.now(),
    );
  }

  close(): void { this.store.close(); }
}

export interface ActionApprovalClaimer {
  claimApprovedAction(input: ClaimApprovedActionInput): ApprovedAction;
}

export class ClientAiTaskPacketPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClientAiTaskPacketPolicyError";
  }
}
