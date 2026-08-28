import { createHash } from "node:crypto";
import { z } from "zod";

import { conversationalQualityDecisionSchema } from
  "../domain/conversational-quality-review.js";
import {
  conversationalQualitySuiteSchema,
  conversationalQualityReviewSchema,
  evaluateConversationalQuality,
} from "../evaluation/conversational-quality-evaluation.js";
import type { ConversationalQualityReviewStore } from
  "../persistence/file-conversational-quality-review-store.js";

const identitySchema = z.object({
  actorId: z.string().trim().min(1).max(120),
  workspaceId: z.string().trim().min(1).max(120),
}).strict();

const submissionSchema = identitySchema.extend({
  packetHash: z.string().regex(/^[a-f0-9]{64}$/),
  overall: z.enum(["approved", "needs_changes", "rejected"]),
  reviews: z.array(z.unknown()).min(1).max(40),
}).strict();

export class ConversationalQualityReviewService {
  constructor(
    private readonly store: ConversationalQualityReviewStore,
    private readonly suite: unknown,
    private readonly ownerScope: { readonly actorId: string; readonly workspaceId: string },
    private readonly now: () => Date = () => new Date(),
  ) {}

  scope() { return { ...this.ownerScope }; }

  async get(input: unknown) {
    this.authorize(identitySchema.parse(input));
    const suite = conversationalQualitySuiteSchema.parse(this.suite);
    const criteria = suite.cases.map(({ id, requiresEvidence, expectedBehaviors }) => ({
      id,
      requiresEvidence,
      expectedBehaviors,
    }));
    const packet = await this.store.readPacket();
    if (packet.status !== "ready") {
      return { packetStatus: packet.status, reviewStatus: "unavailable", packet: null, packetHash: null, criteria, decision: null } as const;
    }
    const packetHash = hashPacket(packet.value);
    const decision = await this.store.readDecision();
    if (decision.status === "missing") {
      return { packetStatus: "ready", reviewStatus: "unreviewed", packet: packet.value, packetHash, criteria, decision: null } as const;
    }
    if (decision.status === "malformed") {
      return { packetStatus: "ready", reviewStatus: "decision_malformed", packet: packet.value, packetHash, criteria, decision: null } as const;
    }
    return {
      packetStatus: "ready",
      reviewStatus: decision.value.packetHash === packetHash ? "complete" : "stale",
      packet: packet.value,
      packetHash,
      criteria,
      decision: decision.value,
    } as const;
  }

  async submit(input: unknown) {
    const request = submissionSchema.parse(input);
    this.authorize(request);
    const packet = await this.store.readPacket();
    if (packet.status !== "ready") throw new ConversationalQualityReviewUnavailableError();
    const packetHash = hashPacket(packet.value);
    if (packetHash !== request.packetHash) throw new ConversationalQualityReviewConflictError();
    const suite = conversationalQualitySuiteSchema.parse(this.suite);
    const expectedIds = [...suite.cases.map((item) => item.id)].sort();
    const submittedIds = request.reviews.map((item) =>
      conversationalQualityReviewSchema.parse(item).caseId
    ).sort();
    if (expectedIds.length !== submittedIds.length ||
        expectedIds.some((id, index) => id !== submittedIds[index])) {
      throw new ConversationalQualityReviewIncompleteError();
    }
    let report;
    try {
      report = evaluateConversationalQuality(suite, request.reviews);
    } catch {
      throw new ConversationalQualityReviewIncompleteError();
    }
    if (request.overall === "approved" && report.gate !== "pass") {
      throw new ConversationalQualityReviewIncompleteError();
    }
    if (request.overall !== "approved" && report.gate === "pass") {
      throw new ConversationalQualityReviewIncompleteError();
    }
    const reviews = request.reviews.map((item) =>
      conversationalQualityReviewSchema.parse(item)
    );
    const decision = conversationalQualityDecisionSchema.parse({
      schemaVersion: "jolene.conversation-quality-human-review.v1",
      suiteId: packet.value.suiteId,
      packetHash,
      model: packet.value.model,
      reviewedAt: this.now().toISOString(),
      reviewer: this.ownerScope.actorId,
      overall: request.overall,
      reviews,
      report: {
        gate: report.gate,
        weightedMean: report.weightedMean,
        failures: report.cases.filter((item) => item.hardFailures.length > 0)
          .map((item) => ({ caseId: item.id, codes: [...item.hardFailures] })),
      },
    });
    await this.store.writeDecision(decision);
    return decision;
  }

  private authorize(scope: { readonly actorId: string; readonly workspaceId: string }) {
    if (scope.actorId !== this.ownerScope.actorId ||
        scope.workspaceId !== this.ownerScope.workspaceId) {
      throw new ConversationalQualityReviewScopeError();
    }
  }
}

function hashPacket(packet: unknown): string {
  return createHash("sha256").update(JSON.stringify(packet)).digest("hex");
}

export class ConversationalQualityReviewScopeError extends Error {
  constructor() { super("Conversation-quality review is restricted to the owner scope."); }
}
export class ConversationalQualityReviewUnavailableError extends Error {
  constructor() { super("The conversation-quality capture packet is unavailable."); }
}
export class ConversationalQualityReviewConflictError extends Error {
  constructor() { super("The conversation-quality packet changed before review was saved."); }
}
export class ConversationalQualityReviewIncompleteError extends Error {
  constructor() { super("Every exact suite case requires a coherent human review."); }
}
