import { z } from "zod";

import { personalityResearchDecisionSchema } from
  "../domain/personality-research-review.js";
import type { PersonalityResearchSnapshot } from
  "../personality/personality-research.js";
import type { PersonalityResearchReviewStore } from
  "../persistence/file-personality-research-review-store.js";

const scopeSchema = z.object({
  actorId: z.string().trim().min(1).max(120),
  workspaceId: z.string().trim().min(1).max(120),
}).strict();

const decisionInputSchema = scopeSchema.extend({
  snapshotHash: z.string().regex(/^[a-f0-9]{64}$/),
  decision: z.enum(["approved", "changes_requested", "rejected"]),
  feedback: z.string().trim().max(4_000).default(""),
}).strict();

export class PersonalityResearchReviewService {
  constructor(
    private readonly loadSnapshot: () => Promise<PersonalityResearchSnapshot>,
    private readonly store: PersonalityResearchReviewStore,
    private readonly ownerScope: { readonly actorId: string; readonly workspaceId: string },
    private readonly now: () => Date = () => new Date(),
  ) {}

  scope() { return { ...this.ownerScope }; }

  async get(input: unknown) {
    const scope = scopeSchema.parse(input);
    this.#authorize(scope);
    const snapshot = await this.loadSnapshot();
    const stored = await this.store.readDecision();
    if (stored.status === "missing") {
      return { reviewStatus: "unreviewed" as const, snapshot, decision: null };
    }
    if (stored.status === "malformed") {
      return { reviewStatus: "decision_malformed" as const, snapshot, decision: null };
    }
    return {
      reviewStatus: stored.value.snapshotHash === snapshot.snapshotHash
        ? "complete" as const
        : "stale" as const,
      snapshot,
      decision: stored.value,
    };
  }

  async submit(input: unknown) {
    const request = decisionInputSchema.parse(input);
    this.#authorize(request);
    const snapshot = await this.loadSnapshot();
    if (snapshot.snapshotHash !== request.snapshotHash) {
      throw new PersonalityResearchReviewConflictError();
    }
    const existing = await this.store.readDecision();
    if (existing.status === "ready" && existing.value.snapshotHash === request.snapshotHash) {
      if (
        existing.value.decision === request.decision &&
        existing.value.feedback === request.feedback
      ) return existing.value;
      throw new PersonalityResearchReviewConflictError();
    }
    const decision = personalityResearchDecisionSchema.parse({
      schemaVersion: "jolene.personality-research-decision.v1",
      snapshotHash: snapshot.snapshotHash,
      decision: request.decision,
      feedback: request.feedback,
      reviewerId: this.ownerScope.actorId,
      workspaceId: this.ownerScope.workspaceId,
      reviewedAt: this.now().toISOString(),
    });
    await this.store.writeDecision(decision);
    return decision;
  }

  #authorize(scope: { readonly actorId: string; readonly workspaceId: string }) {
    if (scope.actorId !== this.ownerScope.actorId ||
      scope.workspaceId !== this.ownerScope.workspaceId) {
      throw new PersonalityResearchReviewScopeError();
    }
  }
}

export class PersonalityResearchReviewScopeError extends Error {}
export class PersonalityResearchReviewConflictError extends Error {}
