import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { WorkContextService } from "../src/application/work-context-service.js";
import { WorkTaskNotFoundError } from "../src/domain/work-context.js";
import { SqliteWorkContextStore } from "../src/persistence/sqlite-work-context-store.js";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("durable task events", () => {
  it("records creation and status transitions without duplicate no-op events", () => {
    let now = new Date("2026-08-26T08:00:00.000Z");
    const store = new SqliteWorkContextStore(":memory:", () => now);
    try {
      const task = createTask(store);
      now = new Date("2026-08-26T08:01:00.000Z");
      store.updateTaskStatus({
        id: task.id,
        actorId: "carl",
        workspaceId: "personal",
        status: "running",
      });
      store.updateTaskStatus({
        id: task.id,
        actorId: "carl",
        workspaceId: "personal",
        status: "running",
      });

      expect(store.listTaskEvents(task.id, "carl", "personal", 20)).toMatchObject([
        {
          kind: "created",
          summary: "Task created.",
          fromStatus: null,
          toStatus: "pending",
          createdAt: "2026-08-26T08:00:00.000Z",
        },
        {
          kind: "status_changed",
          fromStatus: "pending",
          toStatus: "running",
          createdAt: "2026-08-26T08:01:00.000Z",
        },
      ]);
    } finally {
      store.close();
    }
  });

  it("keeps bounded recent manual events in chronological order", () => {
    let tick = 0;
    const store = new SqliteWorkContextStore(
      ":memory:",
      () => new Date(Date.UTC(2026, 7, 26, 8, tick++)),
    );
    try {
      const task = createTask(store);
      for (const [kind, summary] of [
        ["progress", "Implemented the persistence boundary."],
        ["evidence", "Focused persistence tests pass."],
        ["blocker", "Docker Desktop is unavailable."],
      ] as const) {
        store.appendTaskEvent({
          taskId: task.id,
          actorId: "carl",
          workspaceId: "personal",
          kind,
          summary,
        });
      }

      expect(
        store.listTaskEvents(task.id, "carl", "personal", 2)
          .map((event) => event.summary),
      ).toEqual([
        "Focused persistence tests pass.",
        "Docker Desktop is unavailable.",
      ]);
    } finally {
      store.close();
    }
  });

  it("persists events across restart and enforces actor and workspace scope", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "jolene-events-"));
    tempDirectories.push(directory);
    const databasePath = path.join(directory, "jolene.sqlite");
    const first = new SqliteWorkContextStore(databasePath);
    const task = createTask(first);
    const event = first.appendTaskEvent({
      taskId: task.id,
      actorId: "carl",
      workspaceId: "personal",
      kind: "decision",
      summary: "Keep the runtime private-only.",
      details: "Public deployment remains a separate approval gate.",
    });
    first.close();

    const restarted = new SqliteWorkContextStore(databasePath);
    try {
      expect(
        restarted.listTaskEvents(task.id, "carl", "personal", 20),
      ).toContainEqual(event);
      expect(() =>
        restarted.listTaskEvents(task.id, "other", "personal", 20),
      ).toThrow(WorkTaskNotFoundError);
      expect(() =>
        restarted.appendTaskEvent({
          taskId: task.id,
          actorId: "carl",
          workspaceId: "other",
          kind: "progress",
          summary: "Cross-scope mutation must fail.",
        }),
      ).toThrow(WorkTaskNotFoundError);
    } finally {
      restarted.close();
    }
  });

  it("loads only bounded events for the explicitly selected task", () => {
    const store = new SqliteWorkContextStore(":memory:");
    try {
      const selected = createTask(store);
      const other = store.createTask({
        actorId: "carl",
        workspaceId: "personal",
        title: "Other task",
        objective: "Remain isolated.",
      });
      store.appendTaskEvent({
        taskId: selected.id,
        actorId: "carl",
        workspaceId: "personal",
        kind: "progress",
        summary: "Selected progress.",
      });
      store.appendTaskEvent({
        taskId: other.id,
        actorId: "carl",
        workspaceId: "personal",
        kind: "progress",
        summary: "Other progress.",
      });

      const context = store.loadAuthorizedContext({
        actorId: "carl",
        workspaceId: "personal",
        taskId: selected.id,
        memoryLimit: 24,
        taskEventLimit: 1,
        includeSensitiveMemory: false,
      });
      expect(context.taskEvents.map((event) => event.summary)).toEqual([
        "Selected progress.",
      ]);
    } finally {
      store.close();
    }
  });

  it("recalls older relevant task evidence while preserving recent continuity", () => {
    const store = new SqliteWorkContextStore(":memory:");
    try {
      const selected = createTask(store);
      store.appendTaskEvent({
        taskId: selected.id,
        actorId: "carl",
        workspaceId: "personal",
        kind: "evidence",
        summary: "Logic host validation passed for the release build.",
      });
      for (let index = 1; index <= 5; index += 1) {
        store.appendTaskEvent({
          taskId: selected.id,
          actorId: "carl",
          workspaceId: "personal",
          kind: "progress",
          summary: `Routine follow-up ${index}.`,
        });
      }

      const context = store.loadAuthorizedContext({
        actorId: "carl",
        workspaceId: "personal",
        taskId: selected.id,
        memoryLimit: 24,
        taskEventLimit: 3,
        includeSensitiveMemory: false,
        query: "What release validation evidence do we have?",
      });

      expect(context.taskEvents.map((event) => event.summary)).toEqual([
        "Logic host validation passed for the release build.",
        "Routine follow-up 4.",
        "Routine follow-up 5.",
      ]);
      expect(context.taskEventSelection).toMatchObject({
        strategy: "deterministic_lexical_v1",
        candidateCount: 7,
        recentCount: 1,
        queryTerms: expect.arrayContaining(["release", "validation", "evidence"]),
        evidence: expect.arrayContaining([
          expect.objectContaining({
            eventId: context.taskEvents[0]?.id,
            reasons: ["summary_term_match"],
          }),
        ]),
      });
    } finally {
      store.close();
    }
  });

  it("rejects automatic event kinds and oversized content at the application boundary", () => {
    const store = new SqliteWorkContextStore(":memory:");
    const service = new WorkContextService(store);
    try {
      const task = createTask(store);
      expect(() =>
        service.appendTaskEvent({
          taskId: task.id,
          actorId: "carl",
          workspaceId: "personal",
          kind: "status_changed",
          summary: "Manual status event.",
        }),
      ).toThrow();
      expect(() =>
        service.appendTaskEvent({
          taskId: task.id,
          actorId: "carl",
          workspaceId: "personal",
          kind: "progress",
          summary: "x".repeat(501),
        }),
      ).toThrow();
    } finally {
      store.close();
    }
  });
});

function createTask(store: SqliteWorkContextStore) {
  return store.createTask({
    actorId: "carl",
    workspaceId: "personal",
    title: "Persistent task history",
    objective: "Retain scoped task progress across restarts.",
  });
}
