import { z } from "zod";

import { containsLikelySecret } from "../domain/public-portfolio-contract.js";
import type {
  PublicContactIntentReviewStore,
  StoredPublicContactIntent,
} from "../public/public-contact-intent-queue.js";

const identitySchema = z.object({
  actorId: z.string().trim().min(1).max(120),
  workspaceId: z.string().trim().min(1).max(120),
}).strict();

const listSchema = identitySchema.extend({
  status: z.enum(["pending_review", "reviewed"]).optional(),
}).strict();

const intentMutationSchema = identitySchema.extend({
  id: z.string().uuid(),
}).strict();

const replyDraftSchema = intentMutationSchema.extend({
  draft: z.string().trim().min(1).max(4_000).refine(
    (value) => !containsLikelySecret(value),
    { message: "Reply drafts cannot contain likely credentials or secrets." },
  ),
}).strict();

const deleteSchema = intentMutationSchema.extend({
  confirmation: z.literal("delete_contact_intent"),
}).strict();

export class ContactIntentReviewService {
  constructor(
    private readonly store: PublicContactIntentReviewStore,
    private readonly ownerScope: {
      readonly actorId: string;
      readonly workspaceId: string;
    },
    private readonly now: () => Date = () => new Date(),
  ) {}

  scope() {
    return { ...this.ownerScope };
  }

  async list(input: unknown): Promise<readonly StoredPublicContactIntent[]> {
    const request = listSchema.parse(input);
    this.#authorize(request);
    const intents = await this.store.list();
    return request.status
      ? intents.filter((intent) => intent.status === request.status)
      : intents;
  }

  async markReviewed(input: unknown): Promise<StoredPublicContactIntent> {
    const request = intentMutationSchema.parse(input);
    this.#authorize(request);
    return this.store.markReviewed(request.id, this.now().toISOString());
  }

  async saveReplyDraft(input: unknown): Promise<StoredPublicContactIntent> {
    const request = replyDraftSchema.parse(input);
    this.#authorize(request);
    return this.store.saveReplyDraft(
      request.id,
      request.draft,
      this.now().toISOString(),
    );
  }

  async delete(input: unknown): Promise<{ readonly deleted: true }> {
    const request = deleteSchema.parse(input);
    this.#authorize(request);
    await this.store.delete(request.id);
    return { deleted: true };
  }

  #authorize(scope: { readonly actorId: string; readonly workspaceId: string }) {
    if (
      scope.actorId !== this.ownerScope.actorId ||
      scope.workspaceId !== this.ownerScope.workspaceId
    ) {
      throw new ContactIntentReviewScopeError();
    }
  }
}

export class ContactIntentReviewScopeError extends Error {
  constructor() {
    super("Contact intent review is limited to the configured owner scope.");
    this.name = "ContactIntentReviewScopeError";
  }
}
