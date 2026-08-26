import { describe, expect, it } from "vitest";

import { rankTaskEvents } from "../src/domain/task-event-ranking.js";
import type { TaskEvent } from "../src/domain/work-context.js";

describe("rankTaskEvents", () => {
  it("uses a bounded chronological recency fallback without a query", () => {
    const result = rankTaskEvents({
      candidates: [event("one"), event("two"), event("three")],
      query: undefined,
      limit: 2,
    });

    expect(result.events.map((item) => item.id)).toEqual(["two", "three"]);
    expect(result.recentCount).toBe(2);
    expect(result.evidence.map((item) => item.reasons)).toEqual([
      ["recent_continuity"],
      ["recent_continuity"],
    ]);
  });

  it("supplements recent continuity with an older query-relevant event", () => {
    const result = rankTaskEvents({
      candidates: [
        event("release", {
          summary: "Release evidence confirmed.",
          details: "Logic host validation passed.",
        }),
        event("middle-one"),
        event("middle-two"),
        event("recent-one"),
        event("recent-two"),
      ],
      query: "What release evidence do we have?",
      limit: 3,
    });

    expect(result.events.map((item) => item.id)).toEqual([
      "release",
      "recent-one",
      "recent-two",
    ]);
    expect(result.evidence[0]).toMatchObject({
      eventId: "release",
      score: 200,
      matchedTerms: ["release", "evidence"],
      reasons: ["summary_term_match"],
    });
    expect(result.recentCount).toBe(1);
  });

  it("weights summary matches above detail-only matches", () => {
    const result = rankTaskEvents({
      candidates: [
        event("details", { details: "The deployment remains blocked." }),
        event("summary", { summary: "Deployment blocker confirmed." }),
      ],
      query: "deployment",
      limit: 1,
    });

    expect(result.events.map((item) => item.id)).toEqual(["summary"]);
    expect(result.evidence[0]).toMatchObject({
      score: 100,
      reasons: ["summary_term_match"],
    });
  });

  it("normalizes Unicode and breaks score ties by recency", () => {
    const result = rankTaskEvents({
      candidates: [
        event("older", {
          summary: "CAFÉ research complete.",
          createdAt: "2026-08-20T00:00:00.000Z",
        }),
        event("newer", {
          summary: "Café review complete.",
          createdAt: "2026-08-21T00:00:00.000Z",
        }),
      ],
      query: "café",
      limit: 1,
    });

    expect(result.events.map((item) => item.id)).toEqual(["newer"]);
    expect(result.queryTerms).toEqual(["café"]);
  });
});

function event(id: string, overrides: Partial<TaskEvent> = {}): TaskEvent {
  return {
    id,
    taskId: "00000000-0000-4000-8000-000000000001",
    actorId: "carl",
    workspaceId: "personal",
    kind: "progress",
    summary: `Update ${id}.`,
    details: null,
    fromStatus: null,
    toStatus: null,
    createdAt: "2026-08-24T00:00:00.000Z",
    ...overrides,
  };
}
