import { createHash } from "node:crypto";

import type { ActionDataClass, ApprovedAction } from "./action-approval.js";
import { fingerprintExternalAction } from "./action-approval.js";
import type { PrivateWorkScope } from "./private-work-scope.js";

export type ClientAiRecipientId = "jenny" | "maria";
export type ClientAiPacketStatus =
  | "draft"
  | "approved"
  | "rejected"
  | "active"
  | "handoff_required"
  | "closed"
  | "cancelled"
  | "expired";
export type ClientAiContextDataClass = Exclude<ActionDataClass, "sensitive">;
export type ClientAiContextSourceKind =
  | "task_context"
  | "approved_summary"
  | "approved_public_evidence"
  | "workflow_state";
export type ClientAiTranscriptSpeaker = "jolene" | "external_ai";

export interface ClientAiRecipient {
  readonly id: ClientAiRecipientId;
  readonly label: string;
  readonly projectId: "matchmaker-ai" | "inner-avatar-ai";
  readonly senderIdentity: "client_ai:jenny" | "client_ai:maria";
}

export interface ClientAiContextItem {
  readonly label: string;
  readonly content: string;
  readonly dataClass: ClientAiContextDataClass;
  readonly sourceKind: ClientAiContextSourceKind;
}

export interface ExactClientAiTaskPacket {
  readonly taskId: string;
  readonly recipientId: ClientAiRecipientId;
  readonly purpose: string;
  readonly contextItems: readonly ClientAiContextItem[];
  readonly questions: readonly string[];
  readonly turnLimit: number;
  readonly expiresAt: string;
}

export interface ClientAiTaskPacket extends ExactClientAiTaskPacket, PrivateWorkScope {
  readonly id: string;
  readonly recipient: ClientAiRecipient;
  readonly payloadFingerprint: string;
  readonly status: ClientAiPacketStatus;
  readonly turnsUsed: number;
  readonly nextSpeaker: ClientAiTranscriptSpeaker | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly decidedAt: string | null;
  readonly cancelledAt: string | null;
  readonly closedAt: string | null;
  readonly transcript: readonly ClientAiTranscriptTurn[];
  readonly handoffs: readonly ClientAiHandoff[];
}

export interface ClientAiTranscriptTurn {
  readonly id: string;
  readonly packetId: string;
  readonly sequence: number;
  readonly speaker: ClientAiTranscriptSpeaker;
  readonly senderIdentity: string;
  readonly content: string;
  readonly contentFingerprint: string;
  readonly requestId: string;
  readonly createdAt: string;
}

export interface ClientAiHandoffContent {
  readonly summary: string;
  readonly decisions: readonly string[];
  readonly unresolvedQuestions: readonly string[];
  readonly proposedNextAction: string;
}

export interface ClientAiHandoff extends ClientAiHandoffContent {
  readonly id: string;
  readonly packetId: string;
  readonly version: number;
  readonly status: "pending_review" | "changes_requested" | "approved";
  readonly submittedAt: string;
  readonly reviewedAt: string | null;
  readonly reviewFeedback: string | null;
}

export interface CreateClientAiTaskPacketInput extends ExactClientAiTaskPacket, PrivateWorkScope {}

export interface DecideClientAiTaskPacketInput extends PrivateWorkScope {
  readonly id: string;
  readonly decision: "approved" | "rejected";
  readonly expectedFingerprint: string;
}

interface RecordClientAiTurnBase extends PrivateWorkScope {
  readonly id: string;
  readonly requestId: string;
  readonly content: string;
}

export interface RecordJoleneClientAiTurnInput extends RecordClientAiTurnBase {
  readonly speaker: "jolene";
  readonly senderIdentity: "jolene";
  readonly dataClass: ClientAiContextDataClass;
  readonly approvedAction: ApprovedAction;
}

export interface RecordExternalClientAiTurnInput extends RecordClientAiTurnBase {
  readonly speaker: "external_ai";
  readonly senderIdentity: string;
}

export type RecordClientAiTurnInput =
  | RecordJoleneClientAiTurnInput
  | RecordExternalClientAiTurnInput;

export interface SubmitClientAiHandoffInput extends ClientAiHandoffContent, PrivateWorkScope {
  readonly id: string;
}

export interface ReviewClientAiHandoffInput extends PrivateWorkScope {
  readonly id: string;
  readonly handoffId: string;
  readonly decision: "approved" | "changes_requested";
  readonly feedback: string;
}

export interface ClientAiTaskPacketStore {
  create(input: CreateClientAiTaskPacketInput, now: Date): ClientAiTaskPacket;
  get(id: string, scope: PrivateWorkScope, now: Date): ClientAiTaskPacket;
  list(scope: PrivateWorkScope, now: Date, limit: number): readonly ClientAiTaskPacket[];
  decide(input: DecideClientAiTaskPacketInput, now: Date): ClientAiTaskPacket;
  cancel(id: string, scope: PrivateWorkScope, now: Date): ClientAiTaskPacket;
  recordTurn(input: RecordClientAiTurnInput, now: Date): ClientAiTaskPacket;
  submitHandoff(input: SubmitClientAiHandoffInput, now: Date): ClientAiTaskPacket;
  reviewHandoff(input: ReviewClientAiHandoffInput, now: Date): ClientAiTaskPacket;
  close(): void;
}

const RECIPIENTS: readonly ClientAiRecipient[] = [
  {
    id: "jenny",
    label: "Jenny",
    projectId: "matchmaker-ai",
    senderIdentity: "client_ai:jenny",
  },
  {
    id: "maria",
    label: "Maria",
    projectId: "inner-avatar-ai",
    senderIdentity: "client_ai:maria",
  },
];

export function listClientAiRecipients(): readonly ClientAiRecipient[] {
  return RECIPIENTS;
}

export function requireClientAiRecipient(id: ClientAiRecipientId): ClientAiRecipient {
  const recipient = RECIPIENTS.find((candidate) => candidate.id === id);
  if (!recipient) throw new ClientAiRecipientNotFoundError();
  return recipient;
}

export function fingerprintClientAiTaskPacket(packet: ExactClientAiTaskPacket): string {
  return sha256(JSON.stringify({
    taskId: packet.taskId,
    recipientId: packet.recipientId,
    purpose: packet.purpose,
    contextItems: packet.contextItems.map((item) => ({
      label: item.label,
      content: item.content,
      dataClass: item.dataClass,
      sourceKind: item.sourceKind,
    })),
    questions: [...packet.questions],
    turnLimit: packet.turnLimit,
    expiresAt: packet.expiresAt,
  }));
}

export function fingerprintClientAiTurn(content: string): string {
  return sha256(content);
}

export function expectedClientAiOutboundFingerprint(
  packet: ClientAiTaskPacket,
  content: string,
  dataClass: ClientAiContextDataClass,
): string {
  return fingerprintExternalAction({
    capabilityId: "external_message.send",
    taskId: packet.taskId,
    destinationKind: "client_ai",
    destinationId: packet.recipient.projectId,
    content,
    dataClass,
    purpose: packet.purpose,
  });
}

export class ClientAiPacketNotFoundError extends Error {
  constructor() {
    super("The client-AI task packet does not exist in the owner scope.");
    this.name = "ClientAiPacketNotFoundError";
  }
}

export class ClientAiRecipientNotFoundError extends Error {
  constructor() {
    super("The requested client-AI recipient is not registered.");
    this.name = "ClientAiRecipientNotFoundError";
  }
}

export class ClientAiPacketConflictError extends Error {
  constructor(message = "The client-AI task packet cannot accept that transition.") {
    super(message);
    this.name = "ClientAiPacketConflictError";
  }
}

export class ClientAiPacketExpiredError extends Error {
  constructor() {
    super("The client-AI task packet has expired.");
    this.name = "ClientAiPacketExpiredError";
  }
}

export class ClientAiPacketPayloadMismatchError extends Error {
  constructor(message = "The client-AI packet or turn does not match its approved payload.") {
    super(message);
    this.name = "ClientAiPacketPayloadMismatchError";
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
