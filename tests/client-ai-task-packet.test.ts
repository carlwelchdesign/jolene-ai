import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  ClientAiTaskPacketService,
} from "../src/application/client-ai-task-packet-service.js";
import {
  ActionPayloadMismatchError,
  ActionProposalConflictError,
} from "../src/domain/action-approval.js";
import {
  ActionApprovalService,
} from "../src/application/action-approval-service.js";
import {
  ClientAiPacketConflictError,
  ClientAiPacketExpiredError,
  ClientAiPacketPayloadMismatchError,
  expectedClientAiOutboundFingerprint,
  type ClientAiTaskPacket,
} from "../src/domain/client-ai-task-packet.js";
import { WorkTaskNotFoundError } from "../src/domain/work-context.js";
import { SqliteClientAiTaskPacketStore } from "../src/persistence/sqlite-client-ai-task-packet-store.js";
import { SqliteActionApprovalStore } from "../src/persistence/sqlite-action-approval-store.js";

const temporaryDirectories: string[] = [];
const ownerScope = { actorId: "carl", workspaceId: "personal" };
const taskId = "11111111-1111-4111-8111-111111111111";

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true })
  ));
});

describe("review-only client-AI task packets", () => {
  it("binds exact recipient, context, turn limit, transcript, and reviewed handoff", async () => {
    const databasePath = await temporaryDatabase();
    let current = new Date("2026-08-27T12:00:00.000Z");
    const fixture = createFixture(databasePath, () => current);
    const { service } = fixture;
    let packet = service.create(packetInput({ turnLimit: 2 }));
    expect(packet).toMatchObject({
      status: "draft",
      recipient: {
        id: "jenny",
        projectId: "matchmaker-ai",
        senderIdentity: "client_ai:jenny",
      },
      turnsUsed: 0,
      nextSpeaker: "jolene",
    });
    expect(packet.payloadFingerprint).toMatch(/^[a-f0-9]{64}$/);

    packet = service.decide({
      id: packet.id,
      decision: "approved",
      expectedFingerprint: packet.payloadFingerprint,
    });
    expect(packet.status).toBe("approved");
    expect(() => service.decide({
      id: packet.id,
      decision: "rejected",
      expectedFingerprint: packet.payloadFingerprint,
    })).toThrow(ClientAiPacketConflictError);

    packet = recordJolene(fixture, packet, "outbound-1", "Which review step is blocked?");
    expect(packet).toMatchObject({ status: "active", turnsUsed: 1, nextSpeaker: "external_ai" });
    expect(packet.transcript).toHaveLength(1);
    expect(recordJolene(fixture, packet, "outbound-1", "Which review step is blocked?").transcript).toHaveLength(1);
    expect(() => service.recordTurn({
      id: packet.id,
      speaker: "external_ai",
      senderIdentity: "client_ai:maria",
      requestId: "external-1",
      content: "Wrong identity",
    })).toThrow(ClientAiPacketPayloadMismatchError);
    packet = service.recordTurn({
      id: packet.id,
      speaker: "external_ai",
      senderIdentity: "client_ai:jenny",
      requestId: "external-1",
      content: "The evidence review step is blocked.",
    });
    expect(packet).toMatchObject({ status: "active", nextSpeaker: "jolene" });

    packet = recordJolene(fixture, packet, "outbound-2", "What evidence is missing?");
    packet = service.recordTurn({
      id: packet.id,
      speaker: "external_ai",
      senderIdentity: "client_ai:jenny",
      requestId: "external-2",
      content: "The latest owner decision is missing.",
    });
    expect(packet).toMatchObject({
      status: "handoff_required",
      turnsUsed: 2,
      nextSpeaker: null,
    });

    packet = service.submitHandoff({
      id: packet.id,
      summary: "Jenny identified an evidence-review dependency.",
      decisions: ["Keep the workflow in review."],
      unresolvedQuestions: ["Which owner decision is current?"],
      proposedNextAction: "Carl reviews the current owner decision.",
    });
    const firstHandoff = packet.handoffs.at(-1)!;
    expect(firstHandoff).toMatchObject({ version: 1, status: "pending_review" });
    packet = service.reviewHandoff({
      id: packet.id,
      handoffId: firstHandoff.id,
      decision: "changes_requested",
      feedback: "Separate the decision from the open question.",
    });
    expect(packet).toMatchObject({ status: "handoff_required" });
    expect(packet.handoffs.at(-1)?.status).toBe("changes_requested");
    packet = service.submitHandoff({
      id: packet.id,
      summary: "Jenny reported one missing owner decision.",
      decisions: ["The exchange reached its approved turn limit."],
      unresolvedQuestions: ["Which owner decision should govern the review?"],
      proposedNextAction: "Carl selects the governing decision before more work.",
    });
    const revised = packet.handoffs.at(-1)!;
    packet = service.reviewHandoff({
      id: packet.id,
      handoffId: revised.id,
      decision: "approved",
      feedback: "Reviewed by Carl.",
    });
    expect(packet).toMatchObject({ status: "closed", nextSpeaker: null });
    expect(packet.closedAt).toBe(current.toISOString());
    fixture.close();
  });

  it("requires a consumed exact-action approval for every Jolene outbound turn", async () => {
    const databasePath = await temporaryDatabase();
    const current = new Date("2026-08-27T12:00:00.000Z");
    const fixture = createFixture(databasePath, () => current);
    const { service } = fixture;
    let packet = service.create(packetInput());
    packet = service.decide({
      id: packet.id,
      decision: "approved",
      expectedFingerprint: packet.payloadFingerprint,
    });
    const content = "Review the bounded workflow.";
    const wrongProposalId = approveOutbound(fixture, packet, content);
    expect(() => service.recordTurn({
      id: packet.id,
      speaker: "jolene",
      senderIdentity: "jolene",
      requestId: "wrong-content",
      content: "Different content",
      dataClass: "general",
      proposalId: wrongProposalId,
    })).toThrow(ActionPayloadMismatchError);
    const proposalId = approveOutbound(fixture, packet, content);
    packet = service.recordTurn({
      id: packet.id,
      speaker: "jolene",
      senderIdentity: "jolene",
      requestId: "approved-turn",
      content,
      dataClass: "general",
      proposalId,
    });
    expect(packet.transcript).toHaveLength(1);
    expect(() => service.recordTurn({
      id: packet.id,
      speaker: "jolene",
      senderIdentity: "jolene",
      requestId: "different-request",
      content,
      dataClass: "general",
      proposalId,
    })).toThrow(ActionProposalConflictError);
    fixture.close();
  });

  it("enforces owner task scope, expiry, cancellation, and durable restart", async () => {
    const databasePath = await temporaryDatabase();
    let current = new Date("2026-08-27T12:00:00.000Z");
    let fixture = createFixture(databasePath, () => current);
    let { service } = fixture;
    expect(() => service.create(packetInput({ taskId: "22222222-2222-4222-8222-222222222222" })))
      .toThrow(WorkTaskNotFoundError);
    let packet = service.create(packetInput({
      expiresAt: "2026-08-27T12:01:00.000Z",
    }));
    fixture.close();

    current = new Date("2026-08-27T12:02:00.000Z");
    fixture = createFixture(databasePath, () => current);
    service = fixture.service;
    expect(service.get({ id: packet.id }).status).toBe("expired");
    expect(() => service.decide({
      id: packet.id,
      decision: "approved",
      expectedFingerprint: packet.payloadFingerprint,
    })).toThrow(ClientAiPacketExpiredError);

    packet = service.create(packetInput({ recipientId: "maria" }));
    packet = service.cancel({ id: packet.id });
    expect(packet).toMatchObject({ status: "cancelled", nextSpeaker: null });
    expect(service.cancel({ id: packet.id }).status).toBe("cancelled");
    expect(service.list({ limit: 10 })).toHaveLength(2);
    fixture.close();
  });

  it("keeps an exact retry idempotent across two database connections", async () => {
    const databasePath = await temporaryDatabase();
    const current = new Date("2026-08-27T12:00:00.000Z");
    const first = createFixture(databasePath, () => current);
    const second = createFixture(databasePath, () => current);
    let packet = first.service.create(packetInput());
    packet = first.service.decide({
      id: packet.id,
      decision: "approved",
      expectedFingerprint: packet.payloadFingerprint,
    });
    const content = "Confirm the exact review dependency.";
    const proposalId = approveOutbound(first, packet, content);
    const input = {
      id: packet.id,
      speaker: "jolene" as const,
      senderIdentity: "jolene" as const,
      requestId: "shared-retry",
      content,
      dataClass: "general" as const,
      proposalId,
    };
    expect(first.service.recordTurn(input).transcript).toHaveLength(1);
    expect(second.service.recordTurn(input).transcript).toHaveLength(1);
    expect(second.service.get({ id: packet.id })).toMatchObject({
      turnsUsed: 1,
      nextSpeaker: "external_ai",
    });
    first.close();
    second.close();
  });
});

function recordJolene(
  fixture: TestFixture,
  packet: ClientAiTaskPacket,
  requestId: string,
  content: string,
): ClientAiTaskPacket {
  const key = `${packet.id}:${requestId}:${content}`;
  let proposalId = fixture.outboundProposals.get(key);
  if (!proposalId) {
    proposalId = approveOutbound(fixture, packet, content);
    fixture.outboundProposals.set(key, proposalId);
  }
  return fixture.service.recordTurn({
    id: packet.id,
    speaker: "jolene",
    senderIdentity: "jolene",
    requestId,
    content,
    dataClass: "general",
    proposalId,
  });
}

function approveOutbound(
  fixture: TestFixture,
  packet: ClientAiTaskPacket,
  content: string,
): string {
  const proposal = fixture.approvals.createProposal({
    ...ownerScope,
    capabilityId: "external_message.send",
    taskId: packet.taskId,
    destinationKind: "client_ai",
    destinationId: packet.recipient.projectId,
    content,
    dataClass: "general",
    purpose: packet.purpose,
    originChannelKind: "cli",
    expiresAt: packet.expiresAt,
  });
  fixture.approvals.decideProposal({
    ...ownerScope,
    id: proposal.id,
    decision: "approved",
    payloadFingerprint: proposal.payloadFingerprint,
    authority: {
      source: "authenticated_owner_review_ui",
      authority: "user",
      taintIds: [],
      derivationIds: [],
    },
  });
  return proposal.id;
}

function packetInput(overrides: Record<string, unknown> = {}) {
  return {
    taskId,
    recipientId: "jenny",
    purpose: "Clarify the client review workflow.",
    contextItems: [{
      label: "Approved workflow summary",
      content: "The draft is waiting for evidence review.",
      dataClass: "general",
      sourceKind: "approved_summary",
    }],
    questions: ["Which workflow step is blocked?"],
    turnLimit: 3,
    expiresAt: "2026-08-27T13:00:00.000Z",
    ...overrides,
  };
}

interface TestFixture {
  readonly service: ClientAiTaskPacketService;
  readonly approvals: ActionApprovalService;
  readonly outboundProposals: Map<string, string>;
  readonly close: () => void;
}

function createFixture(databasePath: string, now: () => Date): TestFixture {
  const tasks = {
    getTask: (id: string, actorId: string, workspaceId: string) => {
      if (id !== taskId || actorId !== ownerScope.actorId || workspaceId !== ownerScope.workspaceId) {
        throw new WorkTaskNotFoundError();
      }
      return {
        id: taskId,
        ...ownerScope,
        title: "Review workflow",
        objective: "Clarify the exact handoff.",
        status: "running" as const,
        createdAt: "2026-08-27T11:00:00.000Z",
        updatedAt: "2026-08-27T11:00:00.000Z",
      };
    },
  };
  const approvalStore = new SqliteActionApprovalStore(databasePath, now);
  const approvals = new ActionApprovalService(approvalStore, tasks, now);
  const service = new ClientAiTaskPacketService(
    new SqliteClientAiTaskPacketStore(databasePath),
    tasks,
    approvals,
    ownerScope,
    now,
  );
  return {
    service,
    approvals,
    outboundProposals: new Map(),
    close: () => {
      service.close();
      approvalStore.close();
    },
  };
}

async function temporaryDatabase(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "jolene-client-ai-"));
  temporaryDirectories.push(directory);
  return path.join(directory, "jolene.sqlite");
}
