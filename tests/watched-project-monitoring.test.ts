import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { WatchedProjectMonitorService } from "../src/application/watched-project-monitor-service.js";
import type { WatchedProjectDefinition, WatchedProjectSnapshot } from "../src/domain/watched-project.js";
import { SqliteWatchedProjectMonitorStore } from "../src/persistence/sqlite-watched-project-monitor-store.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true })
  ));
});

describe("durable watched-project monitoring", () => {
  it("claims a due scheduled run once and preserves reviewable history across restart", async () => {
    const databasePath = await temporaryDatabase();
    let current = new Date("2026-08-26T12:00:00.000Z");
    const now = () => current;
    const inspect = vi.fn(async () => snapshot(current));
    const firstStore = new SqliteWatchedProjectMonitorStore(databasePath, now);
    const first = new WatchedProjectMonitorService([project()], { inspect }, firstStore, now);

    expect(await first.runDue()).toBe(1);
    expect(await first.runDue()).toBe(0);
    expect(inspect).toHaveBeenCalledOnce();
    expect(first.get("portfolio")).toMatchObject({
      status: "active",
      runCount: 1,
      runsToday: 1,
      history: [{ trigger: "scheduled", status: "succeeded" }],
    });
    first.close();

    current = new Date("2026-08-26T13:00:00.000Z");
    const secondStore = new SqliteWatchedProjectMonitorStore(databasePath, now);
    const second = new WatchedProjectMonitorService([project()], { inspect }, secondStore, now);
    expect(second.get("portfolio").history).toHaveLength(1);
    expect(await second.runDue()).toBe(1);
    expect(second.get("portfolio").history).toHaveLength(2);
    second.close();
  });

  it("honors pause, daily budget, and terminal run-count stop conditions", async () => {
    const databasePath = await temporaryDatabase();
    let current = new Date("2026-08-26T12:00:00.000Z");
    const now = () => current;
    const limited = project({ maxRunsPerDay: 2, stopAfterRuns: 2 });
    const service = new WatchedProjectMonitorService(
      [limited],
      { inspect: async () => snapshot(current) },
      new SqliteWatchedProjectMonitorStore(databasePath, now),
      now,
    );

    service.pause("portfolio");
    expect(await service.runDue()).toBe(0);
    service.resume("portfolio");
    expect(await service.runDue()).toBe(1);
    await service.runNow("portfolio");
    expect(service.get("portfolio")).toMatchObject({
      status: "stopped",
      runCount: 2,
      runsToday: 2,
      nextRunAt: null,
    });
    await expect(service.runNow("portfolio")).rejects.toThrow(/busy, stopped, or/);
    service.close();
  });

  it("keeps scheduling disabled unless the owner configuration enables it", async () => {
    const databasePath = await temporaryDatabase();
    const current = new Date("2026-08-26T12:00:00.000Z");
    const disabled = project({ enabled: false });
    const inspect = vi.fn(async () => snapshot(current));
    const service = new WatchedProjectMonitorService(
      [disabled],
      { inspect },
      new SqliteWatchedProjectMonitorStore(databasePath, () => current),
      () => current,
    );

    expect(service.get("portfolio").status).toBe("paused");
    expect(await service.runDue()).toBe(0);
    expect(() => service.resume("portfolio")).toThrow(/not enabled/);
    expect(inspect).not.toHaveBeenCalled();
    service.close();
  });
});

function project(overrides: Partial<WatchedProjectDefinition["monitoring"]> = {}): WatchedProjectDefinition {
  return {
    id: "portfolio",
    label: "Portfolio",
    rootPath: "/private/project",
    planFile: "PLAN.md",
    reviewWindowDays: 30,
    monitoring: {
      enabled: true,
      cadenceMinutes: 60,
      maxRunsPerDay: 24,
      stopAfterRuns: 720,
      historyLimit: 100,
      ...overrides,
    },
  };
}

function snapshot(now: Date): WatchedProjectSnapshot {
  return {
    id: "portfolio",
    label: "Portfolio",
    checkedAt: now.toISOString(),
    rootExists: true,
    git: { state: "available", branch: "main", revision: "abc", dirty: false, changedFileCount: 0 },
    plan: { configured: true, relativePath: "PLAN.md", exists: true, modifiedAt: now.toISOString(), ageDays: 0 },
    verification: { state: "not_configured", checkedAt: null },
    alerts: [],
  };
}

async function temporaryDatabase(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "jolene-monitor-"));
  temporaryDirectories.push(directory);
  return path.join(directory, "jolene.sqlite");
}
