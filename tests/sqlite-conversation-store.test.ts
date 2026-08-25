import { describe, expect, it } from "vitest";

import type { ConversationAddress } from "../src/domain/conversation.js";
import { SqliteConversationStore } from "../src/persistence/sqlite-conversation-store.js";

const baseAddress: ConversationAddress = {
  actorId: "carl",
  workspaceId: "personal",
  channelKind: "slack_dm",
  channelId: "D123",
  threadId: "thread-1",
};

describe("SqliteConversationStore", () => {
  it("stores a completed exchange atomically and returns newest history chronologically", () => {
    const store = new SqliteConversationStore(":memory:");

    try {
      const firstClaim = store.claimEvent(baseAddress, "event-1", "First");
      expect(firstClaim.kind).toBe("claimed");
      if (firstClaim.kind !== "claimed") throw new Error("Expected claim");
      store.completeEvent(firstClaim.eventKey, {
        userMessage: "First",
        assistantMessage: "One",
      });
      const secondClaim = store.claimEvent(baseAddress, "event-2", "Second");
      if (secondClaim.kind !== "claimed") throw new Error("Expected claim");
      store.completeEvent(secondClaim.eventKey, {
        userMessage: "Second",
        assistantMessage: "Two",
      });

      expect(store.recentTurns(baseAddress, 2).map((turn) => turn.content)).toEqual([
        "Second",
        "Two",
      ]);
    } finally {
      store.close();
    }
  });

  it("deduplicates completed inbound events", () => {
    const store = new SqliteConversationStore(":memory:");

    try {
      const claim = store.claimEvent(baseAddress, "event-1", "Hello");
      if (claim.kind !== "claimed") throw new Error("Expected claim");
      store.completeEvent(claim.eventKey, {
        userMessage: "Hello",
        assistantMessage: "Hi",
      });

      expect(store.claimEvent(baseAddress, "event-1", "Hello again")).toEqual({
        kind: "duplicate",
        status: "completed",
        response: "Hi",
      });
      expect(store.recentTurns(baseAddress, 10)).toHaveLength(2);
    } finally {
      store.close();
    }
  });

  it("keeps separate Slack threads isolated", () => {
    const store = new SqliteConversationStore(":memory:");
    const otherThread = { ...baseAddress, threadId: "thread-2" };

    try {
      const firstClaim = store.claimEvent(
        baseAddress,
        "same-provider-event",
        "Private thread one",
      );
      if (firstClaim.kind !== "claimed") throw new Error("Expected claim");
      store.completeEvent(firstClaim.eventKey, {
        userMessage: "Private thread one",
        assistantMessage: "Response one",
      });
      const secondClaim = store.claimEvent(
        otherThread,
        "same-provider-event",
        "Private thread two",
      );
      if (secondClaim.kind !== "claimed") throw new Error("Expected claim");
      store.completeEvent(secondClaim.eventKey, {
        userMessage: "Private thread two",
        assistantMessage: "Response two",
      });

      expect(store.recentTurns(baseAddress, 10).map((turn) => turn.content)).toEqual([
        "Private thread one",
        "Response one",
      ]);
      expect(store.recentTurns(otherThread, 10).map((turn) => turn.content)).toEqual([
        "Private thread two",
        "Response two",
      ]);
    } finally {
      store.close();
    }
  });

  it("makes failed events retryable without creating dangling turns", () => {
    const store = new SqliteConversationStore(":memory:");

    try {
      const claim = store.claimEvent(baseAddress, "event-1", "Try me");
      if (claim.kind !== "claimed") throw new Error("Expected claim");
      store.failEvent(claim.eventKey, "provider_error");

      expect(store.recentTurns(baseAddress, 10)).toEqual([]);
      expect(store.claimEvent(baseAddress, "event-1", "Try me").kind).toBe(
        "claimed",
      );
    } finally {
      store.close();
    }
  });
});
