import { describe, expect, it } from "vitest";

import { WorkContextService } from "../src/application/work-context-service.js";
import { SqliteWorkContextStore } from "../src/persistence/sqlite-work-context-store.js";

describe("WorkContextService", () => {
  it("validates task and memory proposal commands at the application boundary", () => {
    const store = new SqliteWorkContextStore(":memory:");
    const service = new WorkContextService(store);

    try {
      expect(() =>
        service.createTask({
          actorId: "carl",
          workspaceId: "personal",
          title: "   ",
          objective: "Missing title",
        }),
      ).toThrow();

      const task = service.createTask({
        actorId: "carl",
        workspaceId: "personal",
        title: "Reviewable memory",
        objective: "Create a proposal before durable memory.",
      });
      expect(
        service.listTasks({
          actorId: "carl",
          workspaceId: "personal",
          status: "pending",
        }),
      ).toMatchObject([{ id: task.id, status: "pending" }]);
      const proposal = service.proposeMemory({
        actorId: "carl",
        workspaceId: "personal",
        taskId: task.id,
        kind: "project_decision",
        content: "Use explicit memory proposals.",
        source: "Carl's direct request.",
      });

      expect(
        service.listMemoryProposals({
          actorId: "carl",
          workspaceId: "personal",
          status: "pending",
        }),
      ).toMatchObject([{ id: proposal.id, status: "pending" }]);
    } finally {
      store.close();
    }
  });
});
