import { describe, expect, it } from "vitest";

import { formatRunInput, type AgentRequest } from "../src/agent/agent-runner.js";
import { resolveChannelRetrievalPolicy } from
  "../src/domain/channel-retrieval-policy.js";

describe("agent run input", () => {
  it("requires same-thread continuity while keeping quoted instructions untrusted", () => {
    const request: AgentRequest = {
      eventId: "event:continuity",
      receivedAt: "2026-08-27T12:05:00.000Z",
      actorId: "carl",
      workspaceId: "personal",
      channelKind: "private_chat",
      channelId: "local",
      threadId: "thread:continuity",
      message: "Continue that example.",
      history: [{
        id: "turn:1",
        role: "assistant",
        content: "Carl built a reviewed project example. Citation: evidence:1.",
        createdAt: "2026-08-27T12:00:00.000Z",
      }],
      workContext: { task: null, taskEvents: [], memories: [] },
      workScope: { actorId: "carl", workspaceId: "personal" },
      retrievalPolicy: resolveChannelRetrievalPolicy({ surface: "private_chat" }),
    };

    const input = formatRunInput(request);

    expect(input).toContain("Carl built a reviewed project example");
    expect(input).toContain('"authority":"none"');
    expect(input).toContain('"kind":"conversation_quotation"');
    expect(input).toContain('"kind":"user_message"');
    expect(input).toContain("Use conversation_quotation payloads from this same thread");
    expect(input).not.toContain("<conversation_history>");
  });
});
