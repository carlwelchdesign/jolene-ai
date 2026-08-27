import { describe, expect, it } from "vitest";

import {
  ContactIntentReviewScopeError,
  ContactIntentReviewService,
} from "../src/application/contact-intent-review-service.js";
import type {
  PublicContactIntentReviewStore,
  StoredPublicContactIntent,
} from "../src/public/public-contact-intent-queue.js";

const ownerScope = { actorId: "carl", workspaceId: "personal" };

describe("ContactIntentReviewService", () => {
  it("lists and filters only after exact owner-scope authorization", async () => {
    const store = new MemoryContactStore([
      contact("00000000-0000-4000-8000-000000000001", "pending_review"),
      contact("00000000-0000-4000-8000-000000000002", "reviewed"),
    ]);
    const service = createService(store);

    await expect(service.list({ ...ownerScope, status: "pending_review" }))
      .resolves.toHaveLength(1);
    await expect(service.list({ actorId: "other", workspaceId: "personal" }))
      .rejects.toBeInstanceOf(ContactIntentReviewScopeError);
  });

  it("marks reviewed and saves a bounded inert reply draft", async () => {
    const store = new MemoryContactStore([
      contact("00000000-0000-4000-8000-000000000001", "pending_review"),
    ]);
    const service = createService(store);
    const reviewed = await service.markReviewed({
      ...ownerScope,
      id: "00000000-0000-4000-8000-000000000001",
    });
    expect(reviewed.status).toBe("reviewed");

    const drafted = await service.saveReplyDraft({
      ...ownerScope,
      id: reviewed.intentId,
      draft: "Thank you for reaching out.",
    });
    expect(drafted.replyDraft).toBe("Thank you for reaching out.");
    expect(drafted.status).toBe("reviewed");
  });

  it("rejects oversized or secret-like reply drafts", async () => {
    const store = new MemoryContactStore([
      contact("00000000-0000-4000-8000-000000000001", "pending_review"),
    ]);
    const service = createService(store);
    const input = {
      ...ownerScope,
      id: "00000000-0000-4000-8000-000000000001",
    };

    await expect(service.saveReplyDraft({ ...input, draft: "x".repeat(4_001) }))
      .rejects.toThrow();
    await expect(service.saveReplyDraft({
      ...input,
      draft: `Credential sk-${"a".repeat(32)}`,
    })).rejects.toThrow();
  });

  it("requires exact deletion confirmation", async () => {
    const store = new MemoryContactStore([
      contact("00000000-0000-4000-8000-000000000001", "reviewed"),
    ]);
    const service = createService(store);
    const input = {
      ...ownerScope,
      id: "00000000-0000-4000-8000-000000000001",
    };

    await expect(service.delete({ ...input, confirmation: "delete" }))
      .rejects.toThrow();
    await expect(service.delete({
      ...input,
      confirmation: "delete_contact_intent",
    })).resolves.toEqual({ deleted: true });
    expect(store.intents).toEqual([]);
  });
});

function createService(store: PublicContactIntentReviewStore) {
  return new ContactIntentReviewService(
    store,
    ownerScope,
    () => new Date("2026-08-26T18:00:00.000Z"),
  );
}

function contact(
  intentId: string,
  status: "pending_review" | "reviewed",
): StoredPublicContactIntent {
  return {
    intentId,
    status,
    name: "Recruiter",
    email: "recruiter@example.com",
    message: "Would Carl like to discuss a role?",
    consent: true,
    submittedAt: "2026-08-26T17:00:00.000Z",
    expiresAt: "2026-09-25T17:00:00.000Z",
  };
}

class MemoryContactStore implements PublicContactIntentReviewStore {
  constructor(public intents: StoredPublicContactIntent[]) {}

  async list() {
    return this.intents;
  }

  async markReviewed(intentId: string, reviewedAt: string) {
    return this.update(intentId, {
      status: "reviewed",
      reviewedAt,
    });
  }

  async saveReplyDraft(intentId: string, draft: string, updatedAt: string) {
    return this.update(intentId, {
      status: "reviewed",
      reviewedAt: updatedAt,
      replyDraft: draft,
      replyDraftUpdatedAt: updatedAt,
    });
  }

  async delete(intentId: string) {
    this.intents = this.intents.filter((intent) => intent.intentId !== intentId);
  }

  private update(
    intentId: string,
    patch: Partial<StoredPublicContactIntent>,
  ): StoredPublicContactIntent {
    const index = this.intents.findIndex((intent) => intent.intentId === intentId);
    const current = this.intents[index];
    if (!current) throw new Error("not found");
    const updated = { ...current, ...patch };
    this.intents[index] = updated;
    return updated;
  }
}
