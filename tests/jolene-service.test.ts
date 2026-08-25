import { describe, expect, it } from "vitest";

import type {
  AgentRequest,
  JoleneAgentRunner,
} from "../src/agent/agent-runner.js";
import { JoleneService } from "../src/application/jolene-service.js";
import { SqliteConversationStore } from "../src/persistence/sqlite-conversation-store.js";

class RecordingRunner implements JoleneAgentRunner {
  readonly requests: AgentRequest[] = [];
  failNext = false;

  async respond(request: AgentRequest): Promise<string> {
    this.requests.push(request);
    if (this.failNext) {
      this.failNext = false;
      throw new Error("Synthetic provider failure");
    }
    return `Answer ${this.requests.length}`;
  }
}

describe("JoleneService", () => {
  it("does not call the model twice for a completed event", async () => {
    const store = new SqliteConversationStore(":memory:");
    const runner = new RecordingRunner();
    const service = new JoleneService({ store, runner, maxHistoryTurns: 16 });

    try {
      const input = request({ eventId: "same-event" });
      const first = await service.chat(input);
      const duplicate = await service.chat(input);

      expect(first).toEqual({
        status: "completed",
        duplicate: false,
        response: "Answer 1",
      });
      expect(duplicate).toEqual({
        status: "completed",
        duplicate: true,
        response: "Answer 1",
      });
      expect(runner.requests).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  it("supplies only same-thread history to the runner", async () => {
    const store = new SqliteConversationStore(":memory:");
    const runner = new RecordingRunner();
    const service = new JoleneService({ store, runner, maxHistoryTurns: 16 });

    try {
      await service.chat(request({ eventId: "event-1", threadId: "one" }));
      await service.chat(request({ eventId: "event-2", threadId: "two" }));
      await service.chat(request({ eventId: "event-3", threadId: "one" }));

      expect(runner.requests[0]?.history).toEqual([]);
      expect(runner.requests[1]?.history).toEqual([]);
      expect(runner.requests[2]?.history.map((turn) => turn.content)).toEqual([
        "Hello",
        "Answer 1",
      ]);
    } finally {
      store.close();
    }
  });

  it("can retry a provider failure without persisting a dangling turn", async () => {
    const store = new SqliteConversationStore(":memory:");
    const runner = new RecordingRunner();
    const service = new JoleneService({ store, runner, maxHistoryTurns: 16 });
    const input = request({ eventId: "retry-me" });
    runner.failNext = true;

    try {
      await expect(service.chat(input)).rejects.toThrow("Synthetic provider failure");
      await expect(service.chat(input)).resolves.toMatchObject({
        status: "completed",
        duplicate: false,
      });
      expect(runner.requests[1]?.history).toEqual([]);
    } finally {
      store.close();
    }
  });
});

function request(
  overrides: Partial<Parameters<JoleneService["chat"]>[0]> = {},
): Parameters<JoleneService["chat"]>[0] {
  return {
    eventId: "event-1",
    actorId: "carl",
    workspaceId: "personal",
    channelKind: "private_chat",
    channelId: "local",
    threadId: "main",
    message: "Hello",
    ...overrides,
  };
}
