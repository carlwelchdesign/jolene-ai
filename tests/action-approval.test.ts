import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import {
  ActionApprovalService,
  ActionProposalPolicyError,
} from "../src/application/action-approval-service.js";
import {
  ActionApprovalExpiredError,
  ActionPayloadMismatchError,
  ActionProposalConflictError,
  ActionProposalNotFoundError,
} from "../src/domain/action-approval.js";
import { listCapabilities } from "../src/domain/capability-registry.js";
import { SqliteActionApprovalStore } from "../src/persistence/sqlite-action-approval-store.js";
import { SqliteWorkContextStore } from "../src/persistence/sqlite-work-context-store.js";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("exact action approvals", () => {
  it("registers external messaging as proposal-only exact approval", () => {
    expect(listCapabilities()).toContainEqual({
      id: "external_message.send",
      label: "Send a message to an external recipient",
      owner: "carl",
      dataClasses: ["general", "private", "restricted", "sensitive"],
      baseRisk: "external_write",
      allowedContexts: ["private"],
      approval: "exact_arguments_required",
      audit: ["action_approval"],
      runtime: "proposal_only",
      modelToolName: null,
      inputContract: "external_message.send.proposal.input.v1",
      outputContract: "external_message.send.proposal.output.v1",
    });
  });

  it("creates a task-bound sensitive proposal only from private context", () => {
    const fixture = createFixture();
    try {
      const task = fixture.tasks.createTask({
        actorId: "carl",
        workspaceId: "personal",
        title: "Client coordination",
        objective: "Prepare a bounded handoff.",
      });
      const proposal = fixture.service.createProposal(proposalInput({
        taskId: task.id,
        dataClass: "sensitive",
      }));

      expect(proposal).toMatchObject({
        taskId: task.id,
        effectiveRisk: "sensitive_disclosure",
        status: "pending",
      });
      expect(proposal.payloadFingerprint).toMatch(/^[a-f0-9]{64}$/);
      expect(() => fixture.service.createProposal(proposalInput({
        originChannelKind: "slack_shared",
      }))).toThrow(ActionProposalPolicyError);
      expect(() => fixture.service.createProposal(proposalInput({
        dataClass: "restricted",
        taskId: null,
      }))).toThrow("must be bound to a task");
    } finally {
      fixture.close();
    }
  });

  it("requires an expiry in the next 24 hours", () => {
    const fixture = createFixture();
    try {
      expect(() => fixture.service.createProposal(proposalInput({
        expiresAt: "2026-08-27T12:00:00.000Z",
      }))).toThrow("within the next 24 hours");
      expect(() => fixture.service.createProposal(proposalInput({
        expiresAt: "2026-08-25T11:59:59.000Z",
      }))).toThrow("within the next 24 hours");
    } finally {
      fixture.close();
    }
  });

  it("makes repeated decisions idempotent and contradictory decisions conflicts", () => {
    const fixture = createFixture();
    try {
      const proposal = fixture.service.createProposal(proposalInput());
      const decision = {
        id: proposal.id,
        actorId: "carl",
        workspaceId: "personal",
        decision: "approved",
      } as const;
      expect(fixture.service.decideProposal(decision).status).toBe("approved");
      expect(fixture.service.decideProposal(decision).status).toBe("approved");
      expect(() => fixture.service.decideProposal({
        ...decision,
        decision: "rejected",
      })).toThrow(ActionProposalConflictError);
    } finally {
      fixture.close();
    }
  });

  it("binds one-time claims to the exact approved recipient and content", () => {
    const fixture = createFixture();
    try {
      const exact = proposalInput();
      const proposal = fixture.service.createProposal(exact);
      fixture.service.decideProposal({
        id: proposal.id,
        actorId: "carl",
        workspaceId: "personal",
        decision: "approved",
      });
      expect(() => fixture.service.claimApprovedAction({
        ...claimInput(proposal.id, exact),
        destinationId: "different-client",
      })).toThrow(ActionPayloadMismatchError);

      const claim = fixture.service.claimApprovedAction(
        claimInput(proposal.id, exact),
      );
      expect(claim).toMatchObject({
        proposalId: proposal.id,
        requestId: "delivery-attempt-1",
        payloadFingerprint: proposal.payloadFingerprint,
      });
      expect(fixture.service.claimApprovedAction(
        claimInput(proposal.id, exact),
      )).toEqual(claim);
      expect(() => fixture.service.claimApprovedAction({
        ...claimInput(proposal.id, exact),
        requestId: "delivery-attempt-2",
      })).toThrow(ActionProposalConflictError);
      expect(fixture.service.listProposals({
        actorId: "carl",
        workspaceId: "personal",
        status: "consumed",
      })).toMatchObject([{ id: proposal.id, status: "consumed" }]);
    } finally {
      fixture.close();
    }
  });

  it("expires pending and approved proposals without rewriting rejected history", () => {
    let now = new Date("2026-08-25T12:00:00.000Z");
    const fixture = createFixture(() => now);
    try {
      const pending = fixture.service.createProposal(proposalInput());
      const approved = fixture.service.createProposal(proposalInput({
        destinationId: "approved-client",
      }));
      const rejected = fixture.service.createProposal(proposalInput({
        destinationId: "rejected-client",
      }));
      fixture.service.decideProposal({
        id: approved.id,
        actorId: "carl",
        workspaceId: "personal",
        decision: "approved",
      });
      fixture.service.decideProposal({
        id: rejected.id,
        actorId: "carl",
        workspaceId: "personal",
        decision: "rejected",
      });

      now = new Date("2026-08-25T14:00:00.000Z");
      expect(fixture.service.listProposals({
        actorId: "carl",
        workspaceId: "personal",
      })).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: pending.id, status: "expired" }),
        expect.objectContaining({ id: approved.id, status: "expired" }),
        expect.objectContaining({ id: rejected.id, status: "rejected" }),
      ]));
      expect(() => fixture.service.decideProposal({
        id: pending.id,
        actorId: "carl",
        workspaceId: "personal",
        decision: "approved",
      })).toThrow(ActionApprovalExpiredError);
      expect(() => fixture.service.claimApprovedAction(
        claimInput(approved.id, proposalInput({ destinationId: "approved-client" })),
      )).toThrow(ActionApprovalExpiredError);
    } finally {
      fixture.close();
    }
  });

  it("isolates proposal review by actor and workspace", () => {
    const fixture = createFixture();
    try {
      const proposal = fixture.service.createProposal(proposalInput());
      expect(fixture.service.listProposals({
        actorId: "jenny",
        workspaceId: "personal",
      })).toEqual([]);
      expect(() => fixture.service.decideProposal({
        id: proposal.id,
        actorId: "jenny",
        workspaceId: "personal",
        decision: "approved",
      })).toThrow(ActionProposalNotFoundError);
    } finally {
      fixture.close();
    }
  });

  it("migrates an existing database and preserves approvals across restart", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "jolene-actions-"));
    tempDirectories.push(directory);
    const databasePath = path.join(directory, "jolene.sqlite");
    const legacy = new Database(databasePath);
    legacy.exec("CREATE TABLE existing_records (value TEXT NOT NULL); INSERT INTO existing_records VALUES ('preserved')");
    legacy.close();

    const first = new SqliteActionApprovalStore(databasePath, fixedClock);
    const proposal = first.createProposal(storeProposalInput());
    first.decideProposal({
      id: proposal.id,
      actorId: "carl",
      workspaceId: "personal",
      decision: "approved",
    });
    first.close();

    const restarted = new SqliteActionApprovalStore(databasePath, fixedClock);
    try {
      expect(restarted.listProposals({
        actorId: "carl",
        workspaceId: "personal",
        limit: 10,
      })).toMatchObject([{ id: proposal.id, status: "approved" }]);
      const database = new Database(databasePath, { readonly: true });
      try {
        expect(database.prepare("SELECT value FROM existing_records").get()).toEqual({
          value: "preserved",
        });
      } finally {
        database.close();
      }
    } finally {
      restarted.close();
    }
  });
});

function createFixture(now: () => Date = fixedClock) {
  const tasks = new SqliteWorkContextStore(":memory:", now);
  const approvals = new SqliteActionApprovalStore(":memory:", now);
  return {
    tasks,
    approvals,
    service: new ActionApprovalService(approvals, tasks, now),
    close() {
      approvals.close();
      tasks.close();
    },
  };
}

function fixedClock(): Date {
  return new Date("2026-08-25T12:00:00.000Z");
}

function proposalInput(overrides = {}) {
  return {
    actorId: "carl",
    workspaceId: "personal",
    capabilityId: "external_message.send" as const,
    taskId: null,
    originChannelKind: "private_chat" as const,
    destinationKind: "client_ai" as const,
    destinationId: "jenny-ai",
    content: "Please review the bounded workflow draft.",
    dataClass: "general" as const,
    purpose: "Clarify the client review workflow.",
    expiresAt: "2026-08-25T13:00:00.000Z",
    ...overrides,
  };
}

function storeProposalInput() {
  const { originChannelKind, expiresAt, ...exact } = proposalInput();
  return { ...exact, originChannelKind, expiresAt };
}

function claimInput(proposalId: string, exact: ReturnType<typeof proposalInput>) {
  const { originChannelKind: _origin, expiresAt: _expiry, ...action } = exact;
  return {
    ...action,
    proposalId,
    requestId: "delivery-attempt-1",
  };
}
