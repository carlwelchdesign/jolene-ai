import { createHash } from "node:crypto";
import { z } from "zod";

import {
  publicVoiceLabCaseReviewSchema,
  publicVoiceLabDecisionSchema,
} from "../domain/public-voice-lab-review.js";
import { publicVoiceLabSuiteSchema } from "../evaluation/public-voice-lab-evaluation.js";
import type { PublicVoiceLabReviewStore } from "../persistence/file-public-voice-lab-review-store.js";

const scopeSchema = z.object({ actorId: z.string().trim().min(1).max(120), workspaceId: z.string().trim().min(1).max(120) }).strict();
const submitSchema = scopeSchema.extend({
  packetHash: z.string().regex(/^[a-f0-9]{64}$/),
  overall: z.enum(["approved", "needs_changes", "rejected"]),
  reviews: z.array(z.unknown()).min(1).max(30),
}).strict();

export class PublicVoiceLabReviewService {
  constructor(
    private readonly store: PublicVoiceLabReviewStore,
    private readonly suite: unknown,
    private readonly ownerScope: z.infer<typeof scopeSchema>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  scope() { return { ...this.ownerScope }; }

  async get(input: unknown) {
    this.authorize(scopeSchema.parse(input));
    const suite = publicVoiceLabSuiteSchema.parse(this.suite);
    const packet = await this.store.readPacket();
    if (packet.status !== "ready") return { packetStatus: packet.status, reviewStatus: "unavailable", packet: null, packetHash: null, suite, decision: null } as const;
    const packetHash = hash(packet.value);
    const decision = await this.store.readDecision();
    return {
      packetStatus: "ready",
      reviewStatus: decision.status === "missing" ? "unreviewed" : decision.status === "malformed" ? "decision_malformed" : decision.value.packetHash === packetHash ? "complete" : "stale",
      packet: packet.value,
      packetHash,
      suite,
      decision: decision.status === "ready" ? decision.value : null,
    } as const;
  }

  async submit(input: unknown) {
    const request = submitSchema.parse(input); this.authorize(request);
    const packet = await this.store.readPacket();
    if (packet.status !== "ready" || hash(packet.value) !== request.packetHash) throw new PublicVoiceLabReviewConflictError();
    const suite = publicVoiceLabSuiteSchema.parse(this.suite);
    const reviews = request.reviews.map((value) => publicVoiceLabCaseReviewSchema.parse(value));
    const expected = suite.cases.map((item) => item.id).sort();
    const actual = reviews.map((item) => item.caseId).sort();
    if (expected.some((id, index) => id !== actual[index])) throw new PublicVoiceLabReviewIncompleteError();
    if (request.overall === "approved" && reviews.some((item) => item.outcome !== "approved" || Object.values(item.scores).some((score) => score < 3))) throw new PublicVoiceLabReviewIncompleteError();
    const decision = publicVoiceLabDecisionSchema.parse({ schemaVersion: "jolene.public-voice-lab-human-review.v1", suiteId: suite.suiteId, packetHash: request.packetHash, model: packet.value.model, reviewedAt: this.now().toISOString(), reviewer: this.ownerScope.actorId, overall: request.overall, dimensions: suite.reviewDimensions, reviews });
    await this.store.writeDecision(decision); return decision;
  }

  private authorize(scope: z.infer<typeof scopeSchema>) { if (scope.actorId !== this.ownerScope.actorId || scope.workspaceId !== this.ownerScope.workspaceId) throw new PublicVoiceLabReviewScopeError(); }
}
function hash(packet: unknown) { return createHash("sha256").update(JSON.stringify(packet)).digest("hex"); }
export class PublicVoiceLabReviewScopeError extends Error { constructor() { super("Voice-lab review is restricted to the owner scope."); } }
export class PublicVoiceLabReviewConflictError extends Error { constructor() { super("Voice-lab capture changed before review could be saved."); } }
export class PublicVoiceLabReviewIncompleteError extends Error { constructor() { super("Every voice-lab case requires an explicit review."); } }
