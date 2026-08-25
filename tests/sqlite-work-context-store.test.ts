import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";

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
      const context = restartedStore.loadAuthorizedContext({
        actorId: "carl",
        workspaceId: "personal",
        taskId: task.id,
        memoryLimit: 24,
        includeSensitiveMemory: false,
      });
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
        store.loadAuthorizedContext({
          actorId: "carl",
          workspaceId: "personal",
          taskId: undefined,
          memoryLimit: 24,
          includeSensitiveMemory: false,
        }).memories,
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
        store.loadAuthorizedContext({
          actorId: "carl",
          workspaceId: "personal",
          taskId: undefined,
          memoryLimit: 24,
          includeSensitiveMemory: false,
        }).memories,
      ).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  it("applies task and explicit-request gates to restricted and sensitive memory", () => {
    const store = new SqliteWorkContextStore(":memory:");
    try {
      const task = store.createTask({
        actorId: "carl",
        workspaceId: "personal",
        title: "Sensitive planning",
        objective: "Use private context deliberately.",
      });
      approveMemory(store, {
        taskId: null,
        content: "Global private memory",
        sensitivity: "private",
      });
      approveMemory(store, {
        taskId: task.id,
        content: "Task-restricted memory",
        sensitivity: "restricted",
      });
      approveMemory(store, {
        taskId: task.id,
        content: "Explicit sensitive memory",
        sensitivity: "sensitive",
      });

      expect(contextContents(store, undefined, false)).toEqual([
        "Global private memory",
      ]);
      expect(contextContents(store, task.id, false)).toEqual([
        "Global private memory",
        "Task-restricted memory",
      ]);
      expect(contextContents(store, task.id, true)).toEqual([
        "Explicit sensitive memory",
        "Global private memory",
        "Task-restricted memory",
      ]);
    } finally {
      store.close();
    }
  });

  it("ranks an authorized candidate set against the current request", () => {
    const store = new SqliteWorkContextStore(":memory:");
    try {
      approveMemory(store, {
        taskId: null,
        kind: "project_decision",
        content: "The flight tracker map uses a blue visual system.",
        sensitivity: "private",
      });
      const relevant = approveMemory(store, {
        taskId: null,
        kind: "project_decision",
        content: "The audio plugin release requires Logic host validation.",
        sensitivity: "private",
      });

      const context = store.loadAuthorizedContext({
        actorId: "carl",
        workspaceId: "personal",
        taskId: undefined,
        memoryLimit: 1,
        includeSensitiveMemory: false,
        query: "What remains for the audio plugin release?",
      });

      expect(context.memories.map((memory) => memory.id)).toEqual([
        relevant.id,
      ]);
      expect(context.selection).toMatchObject({
        strategy: "deterministic_lexical_v1",
        candidateCount: 2,
        evidence: [{ memoryId: relevant.id }],
      });
    } finally {
      store.close();
    }
  });

  it("excludes expired memory using an injected clock", () => {
    let now = new Date("2026-08-25T12:00:00.000Z");
    const store = new SqliteWorkContextStore(":memory:", () => now);
    try {
      approveMemory(store, {
        taskId: null,
        content: "Temporary context",
        sensitivity: "private",
        expiresAt: "2026-08-26T12:00:00.000Z",
      });
      expect(contextContents(store, undefined, false)).toEqual([
        "Temporary context",
      ]);

      now = new Date("2026-08-27T12:00:00.000Z");
      expect(contextContents(store, undefined, false)).toEqual([]);
      expect(store.listMemories("carl", "personal")[0]?.state).toBe(
        "expired",
      );
    } finally {
      store.close();
    }
  });

  it("replaces memory only after a correction proposal is approved", () => {
    const store = new SqliteWorkContextStore(":memory:");
    try {
      const original = approveMemory(store, {
        taskId: null,
        content: "The old fact",
        sensitivity: "private",
      });
      const correction = store.proposeMemory({
        actorId: "carl",
        workspaceId: "personal",
        taskId: null,
        kind: "corrected_fact",
        content: "The corrected fact",
        source: "Carl corrected the record.",
        sensitivity: "private",
        replacesMemoryId: original.id,
      });

      expect(contextContents(store, undefined, false)).toEqual([
        "The old fact",
      ]);
      store.decideMemory({
        id: correction.id,
        actorId: "carl",
        workspaceId: "personal",
        decision: "approved",
      });

      expect(contextContents(store, undefined, false)).toEqual([
        "The corrected fact",
      ]);
      expect(
        store
          .listMemories("carl", "personal")
          .find((item) => item.id === original.id)?.state,
      ).toBe("superseded");
    } finally {
      store.close();
    }
  });

  it("forgets retained content and leaves a non-content tombstone", () => {
    const store = new SqliteWorkContextStore(":memory:");
    try {
      const memory = approveMemory(store, {
        taskId: null,
        content: "Content to erase",
        sensitivity: "private",
      });

      expect(
        store.forgetMemory({
          id: memory.id,
          actorId: "carl",
          workspaceId: "personal",
        }),
      ).toMatchObject({ content: "[forgotten]", state: "forgotten" });
      expect(contextContents(store, undefined, false)).toEqual([]);
      expect(
        store.listMemoryProposals("carl", "personal", "approved"),
      ).toMatchObject([
        {
          content: "[forgotten]",
          source: "[redacted by forget request]",
        },
      ]);
    } finally {
      store.close();
    }
  });

  it("migrates pre-governance memory tables with private defaults", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "jolene-legacy-"));
    tempDirectories.push(directory);
    const databasePath = path.join(directory, "jolene.sqlite");
    const legacy = new Database(databasePath);
    legacy.exec(`
      CREATE TABLE work_tasks (
        id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
        title TEXT NOT NULL, objective TEXT NOT NULL, status TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE memory_proposals (
        id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
        task_id TEXT, kind TEXT NOT NULL, content TEXT NOT NULL, source TEXT NOT NULL,
        status TEXT NOT NULL, created_at TEXT NOT NULL, decided_at TEXT
      );
      CREATE TABLE durable_memories (
        id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
        task_id TEXT, kind TEXT NOT NULL, content TEXT NOT NULL,
        source_proposal_id TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
      );
      INSERT INTO memory_proposals VALUES (
        '00000000-0000-4000-8000-000000000001', 'carl', 'personal', NULL,
        'preference', 'Legacy memory', 'Legacy source', 'approved',
        '2026-08-25T00:00:00.000Z', '2026-08-25T00:00:00.000Z'
      );
      INSERT INTO durable_memories VALUES (
        '00000000-0000-4000-8000-000000000002', 'carl', 'personal', NULL,
        'preference', 'Legacy memory',
        '00000000-0000-4000-8000-000000000001', '2026-08-25T00:00:00.000Z'
      );
    `);
    legacy.close();

    const migrated = new SqliteWorkContextStore(databasePath);
    try {
      expect(migrated.listMemories("carl", "personal")).toMatchObject([
        { content: "Legacy memory", sensitivity: "private", state: "active" },
      ]);
    } finally {
      migrated.close();
    }
  });
});

function approveMemory(
  store: SqliteWorkContextStore,
  input: {
    taskId: string | null;
    kind?:
      | "preference"
      | "project_decision"
      | "standing_rule"
      | "corrected_fact";
    content: string;
    sensitivity: "private" | "restricted" | "sensitive";
    expiresAt?: string;
  },
) {
  const proposal = store.proposeMemory({
    actorId: "carl",
    workspaceId: "personal",
    taskId: input.taskId,
    kind: input.kind ?? "preference",
    content: input.content,
    source: "Test fixture.",
    sensitivity: input.sensitivity,
    expiresAt: input.expiresAt ?? null,
  });
  store.decideMemory({
    id: proposal.id,
    actorId: "carl",
    workspaceId: "personal",
    decision: "approved",
  });
  const memory = store
    .listMemories("carl", "personal")
    .find((candidate) => candidate.sourceProposalId === proposal.id);
  if (!memory) throw new Error("Expected approved memory");
  return memory;
}

function contextContents(
  store: SqliteWorkContextStore,
  taskId: string | undefined,
  includeSensitiveMemory: boolean,
): string[] {
  return store
    .loadAuthorizedContext({
      actorId: "carl",
      workspaceId: "personal",
      taskId,
      memoryLimit: 24,
      includeSensitiveMemory,
    })
    .memories.map((memory) => memory.content)
    .sort();
}
