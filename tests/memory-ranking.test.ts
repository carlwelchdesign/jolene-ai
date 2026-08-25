import { describe, expect, it } from "vitest";

import { rankMemories } from "../src/domain/memory-ranking.js";
import type { DurableMemory, WorkTask } from "../src/domain/work-context.js";

const task: WorkTask = {
  id: "00000000-0000-4000-8000-000000000001",
  actorId: "carl",
  workspaceId: "personal",
  title: "Ship the audio plugin",
  objective: "Prepare the release build and host validation.",
  status: "running",
  createdAt: "2026-08-20T00:00:00.000Z",
  updatedAt: "2026-08-25T00:00:00.000Z",
};

describe("rankMemories", () => {
  it("selects an older relevant fact and drops a newer unrelated fact", () => {
    const result = rankMemories({
      candidates: [
        memory({
          id: "newer",
          content: "The flight tracker uses a blue map style.",
          createdAt: "2026-08-25T00:00:00.000Z",
        }),
        memory({
          id: "older",
          content: "The audio plugin release requires Logic host validation.",
          createdAt: "2026-08-20T00:00:00.000Z",
        }),
      ],
      query: "What remains for the audio plugin release?",
      task: null,
      limit: 10,
    });

    expect(result.memories.map((item) => item.id)).toEqual(["older"]);
    expect(result.evidence[0]).toMatchObject({
      memoryId: "older",
      matchedTerms: expect.arrayContaining(["audio", "plugin", "release"]),
      reasons: expect.arrayContaining(["query_term_match"]),
    });
  });

  it("keeps standing rules and preferences as transparent baselines", () => {
    const result = rankMemories({
      candidates: [
        memory({
          id: "rule",
          kind: "standing_rule",
          content: "Never publish without approval.",
        }),
        memory({
          id: "preference",
          kind: "preference",
          content: "Keep status reports concise.",
        }),
        memory({
          id: "fact",
          kind: "corrected_fact",
          content: "A garden fact unrelated to this request.",
        }),
      ],
      query: "Draft the software release notes",
      task: null,
      limit: 10,
    });

    expect(result.memories.map((item) => item.id)).toEqual([
      "rule",
      "preference",
    ]);
    expect(result.evidence.map((item) => item.reasons)).toEqual([
      expect.arrayContaining(["standing_rule_baseline"]),
      expect.arrayContaining(["preference_baseline"]),
    ]);
  });

  it("prioritizes selected-task memory and enforces the output limit", () => {
    const result = rankMemories({
      candidates: [
        memory({
          id: "task",
          taskId: task.id,
          content: "Use the approved release checklist.",
        }),
        memory({
          id: "global",
          content: "Release notes mention the new controls.",
        }),
      ],
      query: "Prepare the release",
      task,
      limit: 1,
    });

    expect(result.memories.map((item) => item.id)).toEqual(["task"]);
    expect(result.evidence[0]?.reasons).toContain("selected_task_scope");
    expect(result.candidateCount).toBe(2);
  });

  it("normalizes case and Unicode when matching terms", () => {
    const result = rankMemories({
      candidates: [memory({ id: "unicode", content: "CAFÉ launch checklist" })],
      query: "café launch",
      task: null,
      limit: 10,
    });

    expect(result.memories.map((item) => item.id)).toEqual(["unicode"]);
    expect(result.queryTerms).toEqual(["café", "launch"]);
  });
});

function memory(
  overrides: Partial<DurableMemory> & Pick<DurableMemory, "id" | "content">,
): DurableMemory {
  const { id, content, ...rest } = overrides;
  return {
    id,
    actorId: "carl",
    workspaceId: "personal",
    taskId: null,
    kind: "corrected_fact",
    content,
    sensitivity: "private",
    expiresAt: null,
    sourceProposalId: `proposal-${id}`,
    createdAt: "2026-08-24T00:00:00.000Z",
    state: "active",
    retiredAt: null,
    ...rest,
  };
}
