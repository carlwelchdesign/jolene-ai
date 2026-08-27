import { z } from "zod";

import {
  publicLiveModelCaseReviewSchema,
  publicLiveModelHumanDecisionSchema,
} from "../domain/public-live-model-review.js";
import type {
  PublicLiveModelReviewStore,
} from "../persistence/file-public-live-model-review-store.js";

const identitySchema = z.object({
  actorId: z.string().trim().min(1).max(120),
  workspaceId: z.string().trim().min(1).max(120),
}).strict();

const submissionSchema = identitySchema.extend({
  suiteHash: z.string().regex(/^[a-f0-9]{64}$/),
  overall: z.enum(["approved", "needs_changes", "rejected"]),
  cases: z.array(publicLiveModelCaseReviewSchema).min(2).max(20),
}).strict();

export class PublicLiveModelReviewService {
  constructor(
    private readonly store: PublicLiveModelReviewStore,
    private readonly ownerScope: {
      readonly actorId: string;
      readonly workspaceId: string;
    },
    private readonly now: () => Date = () => new Date(),
  ) {}

  scope() {
    return { ...this.ownerScope };
  }

  async get(input: unknown) {
    const request = identitySchema.parse(input);
    this.#authorize(request);
    const packet = await this.store.readPacket();
    if (packet.status !== "ready") {
      return {
        packetStatus: packet.status,
        reviewStatus: "unavailable" as const,
        packet: null,
        decision: null,
      };
    }
    const decision = await this.store.readDecision();
    if (decision.status === "missing") {
      return {
        packetStatus: "ready" as const,
        reviewStatus: "unreviewed" as const,
        packet: packet.value,
        decision: null,
      };
    }
    if (decision.status === "malformed") {
      return {
        packetStatus: "ready" as const,
        reviewStatus: "decision_malformed" as const,
        packet: packet.value,
        decision: null,
      };
    }
    const stale = decision.value.suiteHash !== packet.value.suiteHash;
    return {
      packetStatus: "ready" as const,
      reviewStatus: stale ? "stale" as const : "complete" as const,
      packet: packet.value,
      decision: decision.value,
    };
  }

  async submit(input: unknown) {
    const request = submissionSchema.parse(input);
    this.#authorize(request);
    const packet = await this.store.readPacket();
    if (packet.status !== "ready") throw new PublicLiveModelReviewUnavailableError();
    if (packet.value.suiteHash !== request.suiteHash) {
      throw new PublicLiveModelReviewConflictError();
    }
    const packetIds = packet.value.cases.map((item) => item.id).sort();
    const decisionIds = request.cases.map((item) => item.caseId).sort();
    if (JSON.stringify(packetIds) !== JSON.stringify(decisionIds)) {
      throw new PublicLiveModelReviewIncompleteError();
    }
    const decision = publicLiveModelHumanDecisionSchema.parse({
      schemaVersion: "jolene.public-live-model-human-review.v1",
      suiteId: packet.value.suiteId,
      suiteHash: packet.value.suiteHash,
      model: packet.value.model,
      reviewedAt: this.now().toISOString(),
      reviewer: this.ownerScope.actorId,
      overall: request.overall,
      cases: request.cases,
    });
    await this.store.writeDecision(decision);
    return decision;
  }

  #authorize(scope: { readonly actorId: string; readonly workspaceId: string }) {
    if (
      scope.actorId !== this.ownerScope.actorId ||
      scope.workspaceId !== this.ownerScope.workspaceId
    ) {
      throw new PublicLiveModelReviewScopeError();
    }
  }
}

export class PublicLiveModelReviewScopeError extends Error {
  constructor() {
    super("Public live-model review is limited to the configured owner scope.");
    this.name = "PublicLiveModelReviewScopeError";
  }
}

export class PublicLiveModelReviewUnavailableError extends Error {
  constructor() {
    super("The public live-model review packet is unavailable.");
    this.name = "PublicLiveModelReviewUnavailableError";
  }
}

export class PublicLiveModelReviewConflictError extends Error {
  constructor() {
    super("The public live-model review packet changed before the decision was saved.");
    this.name = "PublicLiveModelReviewConflictError";
  }
}

export class PublicLiveModelReviewIncompleteError extends Error {
  constructor() {
    super("Every public live-model case requires an explicit decision.");
    this.name = "PublicLiveModelReviewIncompleteError";
  }
}
