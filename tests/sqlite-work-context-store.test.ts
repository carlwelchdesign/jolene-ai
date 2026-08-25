import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { MemoryProposalConflictError } from "../src/domain/work-context.js";
import { SqliteWorkContextStore } from "../src/persistence/sqlite-work-context-store.js";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("SqliteWorkContextStore", () => {
  it("persists task state and approved memory across restart", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "jolene-work-"));
    tempDirectories.push(directory);
    const databasePath = path.join(directory, "jolene.sqlite");
    const firstStore = new SqliteWorkContextStore(databasePath);
    const task = firstStore.createTask({
      actorId: "carl",
      workspaceId: "personal",
      title: "Persistent task",
      objective: "Survive a restart.",
    });
    firstStore.updateTaskStatus({
      id: task.id,
      actorId: "carl",
      workspaceId: "personal",
      status: "running",
    });
    const proposal = firstStore.proposeMemory({
      actorId: "carl",
      workspaceId: "personal",
      taskId: task.id,
      kind: "standing_rule",
      content: "Never silently create durable memory.",
      source: "Architecture decision.",
    });
    firstStore.decideMemory({
      id: proposal.id,
      actorId: "carl",
      workspaceId: "personal",
      decision: "approved",
    });
    firstStore.close();

    const restartedStore = new SqliteWorkContextStore(databasePath);
    try {
      const context = restartedStore.loadAuthorizedContext(
        "carl",
        "personal",
        task.id,
        24,
      );
      expect(context.task?.status).toBe("running");
      expect(context.memories.map((memory) => memory.content)).toEqual([
        "Never silently create durable memory.",
      ]);
    } finally {
      restartedStore.close();
    }
  });

  it("keeps pending and rejected proposals out of authorized context", () => {
    const store = new SqliteWorkContextStore(":memory:");
    try {
      const pending = store.proposeMemory({
        actorId: "carl",
        workspaceId: "personal",
        taskId: null,
        kind: "preference",
        content: "Pending content",
        source: "Unreviewed inference.",
      });
      const rejected = store.proposeMemory({
        actorId: "carl",
        workspaceId: "personal",
        taskId: null,
        kind: "corrected_fact",
        content: "Rejected content",
        source: "Incorrect claim.",
      });
      store.decideMemory({
        id: rejected.id,
        actorId: "carl",
        workspaceId: "personal",
        decision: "rejected",
      });

      expect(
        store.loadAuthorizedContext("carl", "personal", undefined, 24)
          .memories,
      ).toEqual([]);
      expect(
        store.listMemoryProposals("carl", "personal", "pending"),
      ).toMatchObject([{ id: pending.id, status: "pending" }]);
    } finally {
      store.close();
    }
  });

  it("makes a repeated decision idempotent but rejects a conflicting one", () => {
    const store = new SqliteWorkContextStore(":memory:");
    try {
      const proposal = store.proposeMemory({
        actorId: "carl",
        workspaceId: "personal",
        taskId: null,
        kind: "preference",
        content: "Use concise status updates.",
        source: "Direct request.",
      });
      const decision = {
        id: proposal.id,
        actorId: "carl",
        workspaceId: "personal",
        decision: "approved" as const,
      };

      expect(store.decideMemory(decision).status).toBe("approved");
      expect(store.decideMemory(decision).status).toBe("approved");
      expect(() =>
        store.decideMemory({ ...decision, decision: "rejected" }),
      ).toThrow(MemoryProposalConflictError);
      expect(
        store.loadAuthorizedContext("carl", "personal", undefined, 24)
          .memories,
      ).toHaveLength(1);
    } finally {
      store.close();
    }
  });
});
