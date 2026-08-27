import { z } from "zod";

import {
  PERSONALITY_TUNING_DECISION_VERSION,
  personalityTuningContract,
  personalityTuningDecisionSchema,
  personalityTuningProfileSchema,
} from "../domain/personality-tuning.js";
import type { PersonalityResearchSnapshot } from
  "../personality/personality-research.js";
import type { PersonalityResearchReviewStore } from
  "../persistence/file-personality-research-review-store.js";
import type { PersonalityTuningStore } from
  "../persistence/file-personality-tuning-store.js";

const scopeSchema = z.object({
  actorId: z.string().trim().min(1).max(120),
  workspaceId: z.string().trim().min(1).max(120),
}).strict();

const tuningInputSchema = scopeSchema.extend({
  snapshotHash: z.string().regex(/^[a-f0-9]{64}$/),
  tuningContractHash: z.string().regex(/^[a-f0-9]{64}$/),
  profile: personalityTuningProfileSchema,
  notes: z.string().trim().max(4_000).default(""),
}).strict();

export class PersonalityTuningReviewService {
  #submitQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly loadSnapshot: () => Promise<PersonalityResearchSnapshot>,
    private readonly researchStore: PersonalityResearchReviewStore,
    private readonly tuningStore: PersonalityTuningStore,
    private readonly ownerScope: { readonly actorId: string; readonly workspaceId: string },
    private readonly now: () => Date = () => new Date(),
  ) {}

  async get(input: unknown) {
    const scope = scopeSchema.parse(input);
    this.#authorize(scope);
    const snapshot = await this.loadSnapshot();
    const contract = personalityTuningContract();
    const eligibility = await this.#eligibility(snapshot.snapshotHash);
    const stored = await this.tuningStore.readDecision();
    if (stored.status === "missing") {
      return {
        reviewStatus: eligibility.eligible ? "unreviewed" as const : "blocked" as const,
        eligibility,
        snapshotHash: snapshot.snapshotHash,
        contract,
        decision: null,
      };
    }
    if (stored.status === "malformed") {
      return {
        reviewStatus: "decision_malformed" as const,
        eligibility,
        snapshotHash: snapshot.snapshotHash,
        contract,
        decision: null,
      };
    }
    const current = eligibility.eligible &&
      stored.value.snapshotHash === snapshot.snapshotHash &&
      stored.value.tuningContractHash === contract.contractHash;
    return {
      reviewStatus: current ? "complete" as const : "stale" as const,
      eligibility,
      snapshotHash: snapshot.snapshotHash,
      contract,
      decision: stored.value,
    };
  }

  async submit(input: unknown) {
    const request = tuningInputSchema.parse(input);
    this.#authorize(request);
    const operation = this.#submitQueue.then(() => this.#submit(request));
    this.#submitQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async #submit(request: z.infer<typeof tuningInputSchema>) {
    const snapshot = await this.loadSnapshot();
    const contract = personalityTuningContract();
    if (
      request.snapshotHash !== snapshot.snapshotHash ||
      request.tuningContractHash !== contract.contractHash
    ) {
      throw new PersonalityTuningReviewConflictError();
    }
    const eligibility = await this.#eligibility(snapshot.snapshotHash);
    if (!eligibility.eligible) {
      throw new PersonalityTuningReviewNotEligibleError(eligibility.reason);
    }
    const existing = await this.tuningStore.readDecision();
    if (
      existing.status === "ready" &&
      existing.value.snapshotHash === snapshot.snapshotHash &&
      existing.value.tuningContractHash === contract.contractHash
    ) {
      if (
        JSON.stringify(existing.value.profile) === JSON.stringify(request.profile) &&
        existing.value.notes === request.notes
      ) {
        return existing.value;
      }
      throw new PersonalityTuningReviewConflictError();
    }
    const decision = personalityTuningDecisionSchema.parse({
      schemaVersion: PERSONALITY_TUNING_DECISION_VERSION,
      snapshotHash: snapshot.snapshotHash,
      tuningContractHash: contract.contractHash,
      profile: request.profile,
      notes: request.notes,
      reviewerId: this.ownerScope.actorId,
      workspaceId: this.ownerScope.workspaceId,
      reviewedAt: this.now().toISOString(),
    });
    await this.tuningStore.writeDecision(decision);
    return decision;
  }

  async #eligibility(snapshotHash: string): Promise<PersonalityTuningEligibility> {
    const research = await this.researchStore.readDecision();
    if (research.status === "missing") {
      return { eligible: false, reason: "research_unreviewed" };
    }
    if (research.status === "malformed") {
      return { eligible: false, reason: "research_decision_malformed" };
    }
    if (research.value.snapshotHash !== snapshotHash) {
      return { eligible: false, reason: "research_decision_stale" };
    }
    if (research.value.decision !== "approved") {
      return { eligible: false, reason: "research_not_approved" };
    }
    return { eligible: true, reason: null };
  }

  #authorize(scope: { readonly actorId: string; readonly workspaceId: string }) {
    if (
      scope.actorId !== this.ownerScope.actorId ||
      scope.workspaceId !== this.ownerScope.workspaceId
    ) {
      throw new PersonalityTuningReviewScopeError();
    }
  }
}

export type PersonalityTuningEligibility =
  | { readonly eligible: true; readonly reason: null }
  | {
      readonly eligible: false;
      readonly reason:
        | "research_unreviewed"
        | "research_decision_malformed"
        | "research_decision_stale"
        | "research_not_approved";
    };

export class PersonalityTuningReviewScopeError extends Error {}
export class PersonalityTuningReviewConflictError extends Error {}
export class PersonalityTuningReviewNotEligibleError extends Error {
  constructor(readonly reason: PersonalityTuningEligibility["reason"]) {
    super(reason ?? "personality_tuning_not_eligible");
  }
}
