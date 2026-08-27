import { describe, expect, it } from "vitest";

import type {
  AgentRequest,
  JoleneAgentRunner,
} from "../src/agent/agent-runner.js";
import { JoleneService } from "../src/application/jolene-service.js";
import { SqliteConversationStore } from "../src/persistence/sqlite-conversation-store.js";
import { SqliteWorkContextStore } from "../src/persistence/sqlite-work-context-store.js";

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
    const workContext = new SqliteWorkContextStore(":memory:");
    const runner = new RecordingRunner();
    const service = new JoleneService({
      store,
      runner,
      workContext,
      maxHistoryTurns: 16,
      maxMemoryItems: 24,
    });

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
      workContext.close();
    }
  });

  it("supplies only same-thread history to the runner", async () => {
    const store = new SqliteConversationStore(":memory:");
    const workContext = new SqliteWorkContextStore(":memory:");
    const runner = new RecordingRunner();
    const service = new JoleneService({
      store,
      runner,
      workContext,
      maxHistoryTurns: 16,
      maxMemoryItems: 24,
    });

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
      workContext.close();
    }
  });

  it("can retry a provider failure without persisting a dangling turn", async () => {
    const store = new SqliteConversationStore(":memory:");
    const workContext = new SqliteWorkContextStore(":memory:");
    const runner = new RecordingRunner();
    const service = new JoleneService({
      store,
      runner,
      workContext,
      maxHistoryTurns: 16,
      maxMemoryItems: 24,
    });
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
      workContext.close();
    }
  });

  it("loads only approved, actor-scoped memory into private task context", async () => {
    const store = new SqliteConversationStore(":memory:");
    const workContext = new SqliteWorkContextStore(":memory:");
    const runner = new RecordingRunner();
    const service = new JoleneService({
      store,
      runner,
      workContext,
      maxHistoryTurns: 16,
      maxMemoryItems: 24,
    });

    try {
      const task = workContext.createTask({
        actorId: "carl",
        workspaceId: "personal",
        title: "Build Jolene memory",
        objective: "Give Jolene reviewable long-term memory.",
      });
      const approved = workContext.proposeMemory({
        actorId: "carl",
        workspaceId: "personal",
        taskId: task.id,
        kind: "project_decision",
        content: "Memory writes require review.",
        source: "Carl requested this architecture rule.",
      });
      workContext.decideMemory({
        id: approved.id,
        actorId: "carl",
        workspaceId: "personal",
        decision: "approved",
      });
      workContext.proposeMemory({
        actorId: "carl",
        workspaceId: "personal",
        taskId: task.id,
        kind: "preference",
        content: "This pending proposal must not reach the model.",
        source: "Unreviewed chat inference.",
      });

      await service.chat(request({ eventId: "task-event", taskId: task.id }));

      expect(runner.requests[0]?.workContext.task).toMatchObject({
        id: task.id,
        title: "Build Jolene memory",
      });
      expect(
        runner.requests[0]?.workContext.memories.map((memory) => memory.content),
      ).toEqual(["Memory writes require review."]);
    } finally {
      store.close();
      workContext.close();
    }
  });

  it("loads recent durable task events into private task context", async () => {
    const store = new SqliteConversationStore(":memory:");
    const workContext = new SqliteWorkContextStore(":memory:");
    const runner = new RecordingRunner();
    const service = new JoleneService({
      store,
      runner,
      workContext,
      maxHistoryTurns: 16,
      maxMemoryItems: 24,
    });

    try {
      const task = workContext.createTask({
        actorId: "carl",
        workspaceId: "personal",
        title: "Persistent progress",
        objective: "Keep the next action in context.",
      });
      workContext.appendTaskEvent({
        taskId: task.id,
        actorId: "carl",
        workspaceId: "personal",
        kind: "next_action",
        summary: "Run the full verification suite.",
      });

      await service.chat(request({ eventId: "task-history", taskId: task.id }));

      expect(runner.requests[0]?.workContext.taskEvents).toMatchObject([
        { kind: "created" },
        { kind: "next_action", summary: "Run the full verification suite." },
      ]);
    } finally {
      store.close();
      workContext.close();
    }
  });

  it("selects global durable memory against the current message", async () => {
    const store = new SqliteConversationStore(":memory:");
    const workContext = new SqliteWorkContextStore(":memory:");
    const runner = new RecordingRunner();
    const service = new JoleneService({
      store,
      runner,
      workContext,
      maxHistoryTurns: 16,
      maxMemoryItems: 1,
    });

    try {
      for (const content of [
        "The flight tracker uses a blue map system.",
        "The audio plugin release requires Logic host validation.",
      ]) {
        const proposal = workContext.proposeMemory({
          actorId: "carl",
          workspaceId: "personal",
          taskId: null,
          kind: "project_decision",
          content,
          source: "Approved project record.",
        });
        workContext.decideMemory({
          id: proposal.id,
          actorId: "carl",
          workspaceId: "personal",
          decision: "approved",
        });
      }

      await service.chat(
        request({
          eventId: "ranked-memory",
          message: "What remains for the audio plugin release?",
        }),
      );

      expect(runner.requests[0]?.workContext.memories).toMatchObject([
        { content: "The audio plugin release requires Logic host validation." },
      ]);
      expect(runner.requests[0]?.workContext.selection?.candidateCount).toBe(2);
    } finally {
      store.close();
      workContext.close();
    }
  });

  it("does not expose private task or durable memory in shared channels", async () => {
    const store = new SqliteConversationStore(":memory:");
    const workContext = new SqliteWorkContextStore(":memory:");
    const runner = new RecordingRunner();
    const service = new JoleneService({
      store,
      runner,
      workContext,
      maxHistoryTurns: 16,
      maxMemoryItems: 24,
    });

    try {
      const task = workContext.createTask({
        actorId: "carl",
        workspaceId: "personal",
        title: "Private task",
        objective: "Keep this private.",
      });

      await service.chat(
        request({
          eventId: "shared-event",
          taskId: task.id,
          channelKind: "slack_shared",
        }),
      );

      expect(runner.requests[0]?.workContext).toEqual({
        task: null,
        taskEvents: [],
        memories: [],
      });
    } finally {
      store.close();
      workContext.close();
    }
  });

  it("requires an explicit private request to load sensitive task memory", async () => {
    const store = new SqliteConversationStore(":memory:");
    const workContext = new SqliteWorkContextStore(":memory:");
    const runner = new RecordingRunner();
    const service = new JoleneService({
      store,
      runner,
      workContext,
      maxHistoryTurns: 16,
      maxMemoryItems: 24,
    });

    try {
      const task = workContext.createTask({
        actorId: "carl",
        workspaceId: "personal",
        title: "Sensitive task",
        objective: "Load sensitive context only when requested.",
      });
      const proposal = workContext.proposeMemory({
        actorId: "carl",
        workspaceId: "personal",
        taskId: task.id,
        kind: "corrected_fact",
        content: "Sensitive approved context",
        source: "Direct test authorization.",
        sensitivity: "sensitive",
      });
      workContext.decideMemory({
        id: proposal.id,
        actorId: "carl",
        workspaceId: "personal",
        decision: "approved",
      });

      await service.chat(request({ eventId: "sensitive-off", taskId: task.id }));
      await service.chat(
        request({
          eventId: "sensitive-on",
          taskId: task.id,
          includeSensitiveMemory: true,
        }),
      );

      expect(runner.requests[0]?.workContext.memories).toEqual([]);
      expect(runner.requests[1]?.workContext.memories).toMatchObject([
        { content: "Sensitive approved context", sensitivity: "sensitive" },
      ]);
    } finally {
      store.close();
      workContext.close();
    }
  });

  it("makes an event retryable when authorized context cannot be loaded", async () => {
    const store = new SqliteConversationStore(":memory:");
    const runner = new RecordingRunner();
    let contextAttempts = 0;
    const service = new JoleneService({
      store,
      runner,
      workContext: {
        loadAuthorizedContext() {
          contextAttempts += 1;
          if (contextAttempts === 1) throw new Error("Synthetic context failure");
          return { task: null, taskEvents: [], memories: [] };
        },
      },
      maxHistoryTurns: 16,
      maxMemoryItems: 24,
    });
    const input = request({ eventId: "context-retry" });

    try {
      await expect(service.chat(input)).rejects.toThrow(
        "Synthetic context failure",
      );
      await expect(service.chat(input)).resolves.toMatchObject({
        status: "completed",
        duplicate: false,
      });
      expect(runner.requests).toHaveLength(1);
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
