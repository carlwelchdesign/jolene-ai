import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import {
  ActionApprovalExpiredError,
  ActionPayloadMismatchError,
  ActionProposalConflictError,
  ActionProposalNotFoundError,
  effectiveActionRisk,
  fingerprintExternalAction,
  type ActionApprovalStore,
  type ActionDataClass,
  type ActionDecision,
  type ActionDestinationKind,
  type ActionProposal,
  type ApprovedAction,
  type ClaimApprovedActionInput,
  type CreateActionProposalInput,
  type DecideActionProposalInput,
  type ListActionProposalsInput,
} from "../domain/action-approval.js";
import type { CapabilityId } from "../domain/capability-registry.js";
import type { ChannelKind } from "../domain/conversation.js";
import type { CapabilityRisk } from "../domain/policy.js";

interface ProposalRow {
  readonly id: string;
  readonly actor_id: string;
  readonly workspace_id: string;
  readonly task_id: string | null;
  readonly capability_id: CapabilityId;
  readonly origin_channel_kind: ChannelKind;
  readonly destination_kind: ActionDestinationKind;
  readonly destination_id: string;
  readonly content: string;
  readonly data_class: ActionDataClass;
  readonly purpose: string;
  readonly effective_risk: CapabilityRisk;
  readonly payload_fingerprint: string;
  readonly status: "pending" | ActionDecision | "consumed";
  readonly created_at: string;
  readonly expires_at: string;
  readonly decided_at: string | null;
  readonly consumed_at: string | null;
}

interface ApprovedActionRow {
  readonly id: string;
  readonly proposal_id: string;
  readonly request_id: string;
  readonly actor_id: string;
  readonly workspace_id: string;
  readonly payload_fingerprint: string;
  readonly claimed_at: string;
}

export class SqliteActionApprovalStore implements ActionApprovalStore {
  private readonly database: Database.Database;

  constructor(
    databasePath: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (databasePath !== ":memory:") {
      fs.mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });
    }
    this.database = new Database(databasePath);
    this.database.pragma("journal_mode = WAL");
    this.database.pragma("foreign_keys = ON");
    this.migrate();
  }

  createProposal(input: CreateActionProposalInput): ActionProposal {
    const id = randomUUID();
    const createdAt = this.now().toISOString();
    const payloadFingerprint = fingerprintExternalAction(input);
    this.database.prepare(
      `INSERT INTO action_proposals
        (id, actor_id, workspace_id, task_id, capability_id,
         origin_channel_kind, destination_kind, destination_id, content,
         data_class, purpose, effective_risk, payload_fingerprint, status,
         created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    ).run(
      id,
      input.actorId,
      input.workspaceId,
      input.taskId,
      input.capabilityId,
      input.originChannelKind,
      input.destinationKind,
      input.destinationId,
      input.content,
      input.dataClass,
      input.purpose,
      effectiveActionRisk(input.dataClass),
      payloadFingerprint,
      createdAt,
      input.expiresAt,
    );
    return this.requireProposal(id, input.actorId, input.workspaceId);
  }

  decideProposal(input: DecideActionProposalInput): ActionProposal {
    const decide = this.database.transaction(() => {
      const proposal = this.requireProposal(
        input.id,
        input.actorId,
        input.workspaceId,
      );
      if (proposal.status === "expired") throw new ActionApprovalExpiredError();
      if (proposal.status === input.decision) return proposal;
      if (proposal.status !== "pending") throw new ActionProposalConflictError();

      const result = this.database.prepare(
        `UPDATE action_proposals SET status = ?, decided_at = ?
         WHERE id = ? AND status = 'pending'`,
      ).run(input.decision, this.now().toISOString(), input.id);
      if (result.changes !== 1) throw new ActionProposalConflictError();
      return this.requireProposal(input.id, input.actorId, input.workspaceId);
    });
    return decide();
  }

  listProposals(input: ListActionProposalsInput): readonly ActionProposal[] {
    const rows = this.database.prepare(
      `SELECT * FROM action_proposals
       WHERE actor_id = ? AND workspace_id = ?
       ORDER BY created_at DESC, id DESC LIMIT 1000`,
    ).all(input.actorId, input.workspaceId) as ProposalRow[];
    const proposals = rows.map((row) => mapProposal(row, this.now()));
    const filtered = input.status
      ? proposals.filter((proposal) => proposal.status === input.status)
      : proposals;
    return filtered.slice(0, input.limit);
  }

  claimApprovedAction(input: ClaimApprovedActionInput): ApprovedAction {
    const claim = this.database.transaction(() => {
      const fingerprint = fingerprintExternalAction(input);
      const existing = this.findClaim(
        input.actorId,
        input.workspaceId,
        input.requestId,
      );
      if (existing) {
        if (
          existing.proposalId !== input.proposalId ||
          existing.payloadFingerprint !== fingerprint
        ) {
          throw new ActionPayloadMismatchError();
        }
        return existing;
      }

      const proposal = this.requireProposal(
        input.proposalId,
        input.actorId,
        input.workspaceId,
      );
      if (proposal.status === "expired") throw new ActionApprovalExpiredError();
      if (proposal.status !== "approved") throw new ActionProposalConflictError();
      if (proposal.payloadFingerprint !== fingerprint) {
        throw new ActionPayloadMismatchError();
      }

      const id = randomUUID();
      const claimedAt = this.now().toISOString();
      this.database.prepare(
        `INSERT INTO approved_actions
          (id, proposal_id, request_id, actor_id, workspace_id,
           payload_fingerprint, claimed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        input.proposalId,
        input.requestId,
        input.actorId,
        input.workspaceId,
        fingerprint,
        claimedAt,
      );
      const update = this.database.prepare(
        `UPDATE action_proposals SET status = 'consumed', consumed_at = ?
         WHERE id = ? AND status = 'approved'`,
      ).run(claimedAt, input.proposalId);
      if (update.changes !== 1) throw new ActionProposalConflictError();
      return this.requireClaim(id);
    });
    return claim();
  }

  close(): void {
    this.database.close();
  }

  private requireProposal(
    id: string,
    actorId: string,
    workspaceId: string,
  ): ActionProposal {
    const row = this.database.prepare(
      `SELECT * FROM action_proposals
       WHERE id = ? AND actor_id = ? AND workspace_id = ?`,
    ).get(id, actorId, workspaceId) as ProposalRow | undefined;
    if (!row) throw new ActionProposalNotFoundError();
    return mapProposal(row, this.now());
  }

  private findClaim(
    actorId: string,
    workspaceId: string,
    requestId: string,
  ): ApprovedAction | null {
    const row = this.database.prepare(
      `SELECT * FROM approved_actions
       WHERE actor_id = ? AND workspace_id = ? AND request_id = ?`,
    ).get(actorId, workspaceId, requestId) as ApprovedActionRow | undefined;
    return row ? mapClaim(row) : null;
  }

  private requireClaim(id: string): ApprovedAction {
    const row = this.database.prepare(
      "SELECT * FROM approved_actions WHERE id = ?",
    ).get(id) as ApprovedActionRow | undefined;
    if (!row) throw new Error("Approved action claim was not committed.");
    return mapClaim(row);
  }

  private migrate(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS action_proposals (
        id TEXT PRIMARY KEY,
        actor_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        task_id TEXT,
        capability_id TEXT NOT NULL CHECK(capability_id IN ('external_message.send')),
        origin_channel_kind TEXT NOT NULL CHECK(origin_channel_kind IN (
          'cli', 'private_chat', 'slack_dm', 'slack_private', 'slack_shared'
        )),
        destination_kind TEXT NOT NULL CHECK(destination_kind IN (
          'slack_user', 'slack_channel', 'client_ai'
        )),
        destination_id TEXT NOT NULL,
        content TEXT NOT NULL,
        data_class TEXT NOT NULL CHECK(data_class IN (
          'general', 'private', 'restricted', 'sensitive'
        )),
        purpose TEXT NOT NULL,
        effective_risk TEXT NOT NULL CHECK(effective_risk IN (
          'external_write', 'sensitive_disclosure'
        )),
        payload_fingerprint TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN (
          'pending', 'approved', 'rejected', 'consumed'
        )),
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        decided_at TEXT,
        consumed_at TEXT
      );

      CREATE INDEX IF NOT EXISTS action_proposals_scope_status
        ON action_proposals(actor_id, workspace_id, status, created_at DESC);

      CREATE TABLE IF NOT EXISTS approved_actions (
        id TEXT PRIMARY KEY,
        proposal_id TEXT NOT NULL UNIQUE
          REFERENCES action_proposals(id) ON DELETE RESTRICT,
        request_id TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        payload_fingerprint TEXT NOT NULL,
        claimed_at TEXT NOT NULL,
        UNIQUE(actor_id, workspace_id, request_id)
      );
    `);
  }
}

function mapProposal(row: ProposalRow, now: Date): ActionProposal {
  const status =
    (row.status === "pending" || row.status === "approved") &&
    new Date(row.expires_at) <= now
    ? "expired"
    : row.status;
  return {
    id: row.id,
    actorId: row.actor_id,
    workspaceId: row.workspace_id,
    taskId: row.task_id,
    capabilityId: row.capability_id,
    originChannelKind: row.origin_channel_kind,
    destinationKind: row.destination_kind,
    destinationId: row.destination_id,
    content: row.content,
    dataClass: row.data_class,
    purpose: row.purpose,
    effectiveRisk: row.effective_risk,
    payloadFingerprint: row.payload_fingerprint,
    status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    decidedAt: row.decided_at,
    consumedAt: row.consumed_at,
  };
}

function mapClaim(row: ApprovedActionRow): ApprovedAction {
  return {
    id: row.id,
    proposalId: row.proposal_id,
    requestId: row.request_id,
    actorId: row.actor_id,
    workspaceId: row.workspace_id,
    payloadFingerprint: row.payload_fingerprint,
    claimedAt: row.claimed_at,
  };
}
