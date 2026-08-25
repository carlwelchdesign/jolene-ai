import { describe, expect, it } from "vitest";

import type { JoleneAgentRunner } from "../src/agent/agent-runner.js";
import { JoleneService } from "../src/application/jolene-service.js";
import { SqliteConversationStore } from "../src/persistence/sqlite-conversation-store.js";
import { handleSlackEvent, type SlackPost } from "../src/slack/event-handler.js";

const runner: JoleneAgentRunner = {
  async respond() {
    return "I can help with that.";
  },
};

describe("handleSlackEvent", () => {
  it("posts a generated response once and suppresses a replay", async () => {
    const store = new SqliteConversationStore(":memory:");
    const service = new JoleneService({ store, runner, maxHistoryTurns: 16 });
    const posts: SlackPost[] = [];

    try {
      const first = await handleSlackEvent(
        service,
        envelope(),
        "UJOLENE",
        "UCARL",
        async (post) => {
          posts.push(post);
        },
      );
      const replay = await handleSlackEvent(
        service,
        envelope(),
        "UJOLENE",
        "UCARL",
        async (post) => {
          posts.push(post);
        },
      );

      expect(first).toEqual({ outcome: "posted" });
      expect(replay).toEqual({ outcome: "duplicate" });
      expect(posts).toEqual([
        {
          channel: "D123",
          threadTs: "1710000000.000100",
          text: "I can help with that.",
        },
      ]);
    } finally {
      store.close();
    }
  });

  it("surfaces a Slack delivery failure and suppresses unsafe automatic replay", async () => {
    const store = new SqliteConversationStore(":memory:");
    const service = new JoleneService({ store, runner, maxHistoryTurns: 16 });

    try {
      await expect(
        handleSlackEvent(
          service,
          envelope(),
          "UJOLENE",
          "UCARL",
          async () => {
            throw new Error("Synthetic Slack failure");
          },
        ),
      ).rejects.toThrow("Synthetic Slack failure");

      await expect(
        handleSlackEvent(
          service,
          envelope(),
          "UJOLENE",
          "UCARL",
          async () => {
            throw new Error("Must not post a duplicate");
          },
        ),
      ).resolves.toEqual({ outcome: "duplicate" });
    } finally {
      store.close();
    }
  });
});

function envelope(): unknown {
  return {
    event_id: "Ev123",
    team_id: "TWORK",
    event: {
      type: "message",
      user: "UCARL",
      channel: "D123",
      channel_type: "im",
      text: "Hello Jolene",
      ts: "1710000000.000100",
    },
  };
}
