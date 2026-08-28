import { describe, expect, it } from "vitest";

import { mapSlackEvent } from "../src/slack/event-mapper.js";

describe("mapSlackEvent", () => {
  it("maps a direct message to a private, thread-isolated request", () => {
    expect(
      mapSlackEvent(
        envelope({
          type: "message",
          channel_type: "im",
          text: "Help me plan today",
        }),
        "UJOLENE",
        "UCARL",
        "TWORK",
      ),
    ).toEqual({
      request: {
        eventId: "Ev123",
        actorId: "UCARL",
        workspaceId: "TWORK",
        channelKind: "slack_dm",
        channelId: "D123",
        threadId: "1710000000.000100",
        message: "Help me plan today",
      },
      replyThreadTs: "1710000000.000100",
    });
  });

  it("maps a channel mention to shared context and strips Jolene's mention", () => {
    const result = mapSlackEvent(
      envelope({
        type: "app_mention",
        channel_type: "channel",
        channel: "C123",
        thread_ts: "1709999999.000001",
        text: "<@UJOLENE>   summarize this handoff",
      }),
      "UJOLENE",
      "UCARL",
      "TWORK",
    );

    expect(result?.request).toMatchObject({
      channelKind: "slack_shared",
      channelId: "C123",
      threadId: "1709999999.000001",
      message: "summarize this handoff",
    });
  });

  it("ignores ambient channel messages, bot messages, and edits", () => {
    expect(
      mapSlackEvent(
        envelope({ type: "message", channel_type: "channel" }),
        "UJOLENE",
        "UCARL",
        "TWORK",
      ),
    ).toBeNull();
    expect(
      mapSlackEvent(
        envelope({ type: "message", bot_id: "B123" }),
        "UJOLENE",
        "UCARL",
        "TWORK",
      ),
    ).toBeNull();
    expect(
      mapSlackEvent(
        envelope({ type: "message", subtype: "message_changed" }),
        "UJOLENE",
        "UCARL",
        "TWORK",
      ),
    ).toBeNull();
  });

  it("ignores direct messages from anyone except the configured owner", () => {
    expect(
      mapSlackEvent(
        envelope({ type: "message", user: "UOTHER", channel_type: "im" }),
        "UJOLENE",
        "UCARL",
        "TWORK",
      ),
    ).toBeNull();
  });

  it("ignores matching member IDs from another Slack workspace", () => {
    const otherWorkspace = envelope() as Record<string, unknown>;
    otherWorkspace.team_id = "TOTHER";
    expect(mapSlackEvent(otherWorkspace, "UJOLENE", "UCARL", "TWORK"))
      .toBeNull();
  });
});

function envelope(overrides: Record<string, unknown> = {}): unknown {
  return {
    event_id: "Ev123",
    team_id: "TWORK",
    event: {
      type: "message",
      user: "UCARL",
      channel: "D123",
      channel_type: "im",
      text: "Hello",
      ts: "1710000000.000100",
      ...overrides,
    },
  };
}
