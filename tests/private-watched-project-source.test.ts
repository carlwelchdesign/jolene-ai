import { describe, expect, it, vi } from "vitest";

import { OwnerWatchedProjectSource } from "../src/application/private-watched-project-source.js";
import { WatchedProjectService } from "../src/application/watched-project-service.js";
import {
  WatchedProjectAccessDeniedError,
  WatchedProjectNotFoundError,
  type WatchedProjectInspector,
  type WatchedProjectSnapshot,
} from "../src/domain/watched-project.js";

const ownerScope = { actorId: "carl", workspaceId: "personal" };

describe("OwnerWatchedProjectSource", () => {
  it("authorizes only the exact canonical owner scope", () => {
    const source = createSource().source;

    expect(source.canReview(ownerScope)).toBe(true);
    expect(source.canReview({ actorId: "other", workspaceId: "personal" }))
      .toBe(false);
    expect(source.canReview({ actorId: "carl", workspaceId: "other" }))
      .toBe(false);
    expect(source.canReview(null)).toBe(false);
  });

  it("lists public-safe summaries and returns a fresh exact snapshot", async () => {
    const { source, inspect } = createSource();

    const projects = source.list(ownerScope);
    const snapshot = await source.snapshot("portfolio", ownerScope);

    expect(projects).toEqual([{
      id: "portfolio",
      label: "Portfolio",
      planFile: "PLAN.md",
      reviewWindowDays: 30,
      monitoring: {
        enabled: false,
        cadenceMinutes: 60,
        maxRunsPerDay: 24,
        stopAfterRuns: 720,
        historyLimit: 100,
      },
    }]);
    expect(JSON.stringify(projects)).not.toContain("/private/project/root");
    expect(snapshot).toMatchObject({
      id: "portfolio",
      checkedAt: "2026-08-26T00:00:00.000Z",
      alerts: ["uncommitted_changes"],
    });
    expect(inspect).toHaveBeenCalledOnce();
  });

  it("fails closed before directory access for another scope", () => {
    const { source, inspect } = createSource();
    const otherScope = { actorId: "other", workspaceId: "personal" };

    expect(() => source.list(otherScope)).toThrow(
      WatchedProjectAccessDeniedError,
    );
    expect(() => source.snapshot("portfolio", otherScope)).toThrow(
      WatchedProjectAccessDeniedError,
    );
    expect(inspect).not.toHaveBeenCalled();
  });

  it("preserves exact configured-project lookup", async () => {
    const { source, inspect } = createSource();

    await expect(source.snapshot("unknown", ownerScope)).rejects.toBeInstanceOf(
      WatchedProjectNotFoundError,
    );
    expect(inspect).not.toHaveBeenCalled();
  });
});

function createSource(): {
  readonly source: OwnerWatchedProjectSource;
  readonly inspect: ReturnType<typeof vi.fn<WatchedProjectInspector["inspect"]>>;
} {
  const inspect = vi.fn<WatchedProjectInspector["inspect"]>(async (project) =>
    snapshot(project.id, project.label)
  );
  const directory = new WatchedProjectService(
    [{
      id: "portfolio",
      label: "Portfolio",
      rootPath: "/private/project/root",
      planFile: "PLAN.md",
      reviewWindowDays: 30,
      monitoring: {
        enabled: false,
        cadenceMinutes: 60,
        maxRunsPerDay: 24,
        stopAfterRuns: 720,
        historyLimit: 100,
      },
    }],
    { inspect },
  );

  return {
    source: new OwnerWatchedProjectSource(directory, ownerScope),
    inspect,
  };
}

function snapshot(id: string, label: string): WatchedProjectSnapshot {
  return {
    id,
    label,
    checkedAt: "2026-08-26T00:00:00.000Z",
    rootExists: true,
    git: {
      state: "available",
      branch: "main",
      revision: "abc123",
      dirty: true,
      changedFileCount: 1,
    },
    plan: {
      configured: true,
      relativePath: "PLAN.md",
      exists: true,
      modifiedAt: "2026-08-25T00:00:00.000Z",
      ageDays: 1,
    },
    verification: { state: "not_configured", checkedAt: null },
    alerts: ["uncommitted_changes"],
  };
}
