import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { WatchedProjectMonitorService } from "../src/application/watched-project-monitor-service.js";
import { WatchedProjectNotificationService } from "../src/application/watched-project-notification-service.js";
import { deriveWatchedProjectNotification } from "../src/domain/watched-project-notification.js";
import type {
  WatchedProjectAlert,
  WatchedProjectDefinition,
  WatchedProjectSnapshot,
} from "../src/domain/watched-project.js";
import { SqliteWatchedProjectMonitorStore } from "../src/persistence/sqlite-watched-project-monitor-store.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true })
  ));
});

describe("Project Watch notification transitions", () => {
  const policy = { enabled: true, destination: "slack_owner_dm", maxAttempts: 5 } as const;

  it("emits only scheduled attention transitions", () => {
    const clear = snapshot([], "2026-08-26T12:00:00.000Z");
    const dirty = snapshot(["uncommitted_changes"], "2026-08-26T13:00:00.000Z");
    const stale = snapshot(["plan_stale"], "2026-08-26T14:00:00.000Z");
    const resolved = snapshot([], "2026-08-26T15:00:00.000Z");

    expect(deriveWatchedProjectNotification(null, clear, "scheduled", policy)).toBeNull();
    expect(deriveWatchedProjectNotification(clear, dirty, "scheduled", policy)).toMatchObject({
      transition: "attention_started",
      alertCodes: ["uncommitted_changes"],
    });
    expect(deriveWatchedProjectNotification(dirty, dirty, "scheduled", policy)).toBeNull();
    expect(deriveWatchedProjectNotification(dirty, stale, "scheduled", policy)).toMatchObject({
      transition: "attention_changed",
      alertCodes: ["plan_stale"],
    });
    expect(deriveWatchedProjectNotification(stale, resolved, "scheduled", policy)).toMatchObject({
      transition: "attention_resolved",
      alertCodes: ["plan_stale"],
    });
    expect(deriveWatchedProjectNotification(clear, dirty, "manual", policy)).toBeNull();
    expect(deriveWatchedProjectNotification(clear, dirty, "scheduled", { ...policy, enabled: false })).toBeNull();
  });

  it("atomically retains started, changed, and resolved intents without no-change spam", async () => {
    const databasePath = await temporaryDatabase();
    let current = new Date("2026-08-26T12:00:00.000Z");
    const sequence: WatchedProjectAlert[][] = [
      [],
      ["uncommitted_changes"],
      ["uncommitted_changes"],
      ["plan_stale"],
      [],
    ];
    const store = new SqliteWatchedProjectMonitorStore(databasePath, () => current);
    const monitor = new WatchedProjectMonitorService(
      [project()],
      { inspect: async () => snapshot(sequence.shift() ?? [], current.toISOString()) },
      store,
      () => current,
    );

    for (let index = 0; index < 5; index += 1) {
      expect(await monitor.runDue()).toBe(1);
      current = new Date(current.getTime() + 60 * 60_000);
    }
    expect(monitor.get("portfolio").notifications.map((item) => item.transition)).toEqual([
      "attention_resolved",
      "attention_changed",
      "attention_started",
    ]);
    expect(monitor.get("portfolio").notifications.every((item) => item.status === "pending")).toBe(true);
    monitor.close();
  });

  it("delivers once, survives restart, and never puts private project state in the message", async () => {
    const databasePath = await temporaryDatabase();
    let current = new Date("2026-08-26T12:00:00.000Z");
    const now = () => current;
    const firstStore = new SqliteWatchedProjectMonitorStore(databasePath, now);
    const monitor = new WatchedProjectMonitorService(
      [project()],
      { inspect: async () => snapshot(["plan_missing"], current.toISOString()) },
      firstStore,
      now,
    );
    await monitor.runDue();
    const notifications = new WatchedProjectNotificationService([project()], firstStore, now);
    const post = vi.fn(async (_notification: { notificationId: string; text: string }) => undefined);
    expect(await notifications.drainPending(post)).toEqual({ delivered: 1, failed: 0 });
    expect(post).toHaveBeenCalledOnce();
    const message = post.mock.calls[0]?.[0].text ?? "";
    expect(message).toContain("Portfolio needs attention");
    expect(message).toContain("project plan missing");
    expect(message).not.toContain("/private/project");
    expect(message).not.toContain("PLAN.md");
    monitor.close();

    current = new Date("2026-08-26T13:00:00.000Z");
    const restartedStore = new SqliteWatchedProjectMonitorStore(databasePath, now);
    const restarted = new WatchedProjectNotificationService([project()], restartedStore, now);
    expect(await restarted.drainPending(post)).toEqual({ delivered: 0, failed: 0 });
    expect(post).toHaveBeenCalledOnce();
    restartedStore.close();
  });

  it("classifies failures, waits for retry, and delivers on the next due attempt", async () => {
    const databasePath = await temporaryDatabase();
    let current = new Date("2026-08-26T12:00:00.000Z");
    const now = () => current;
    const store = new SqliteWatchedProjectMonitorStore(databasePath, now);
    const monitor = new WatchedProjectMonitorService(
      [project()],
      { inspect: async () => snapshot(["git_unavailable"], current.toISOString()) },
      store,
      now,
    );
    await monitor.runDue();
    const notifications = new WatchedProjectNotificationService([project()], store, now);
    const unavailable = new Error("provider details must not persist");
    unavailable.name = "SlackUnavailable";
    expect(await notifications.drainPending(async () => { throw unavailable; })).toEqual({
      delivered: 0,
      failed: 1,
    });
    expect(monitor.get("portfolio").notifications[0]).toMatchObject({
      status: "failed",
      attempts: 1,
      errorCode: "slackunavailable",
    });
    expect(JSON.stringify(monitor.get("portfolio").notifications)).not.toContain("provider details");
    expect(await notifications.drainPending(async () => undefined)).toEqual({ delivered: 0, failed: 0 });

    current = new Date(current.getTime() + 60_000);
    expect(await notifications.drainPending(async () => undefined)).toEqual({ delivered: 1, failed: 0 });
    expect(monitor.get("portfolio").notifications[0]).toMatchObject({ status: "delivered", attempts: 2 });
    monitor.close();
  });

  it("abandons delivery at the configured retry limit", async () => {
    const databasePath = await temporaryDatabase();
    let current = new Date("2026-08-26T12:00:00.000Z");
    const now = () => current;
    const limited = project(2);
    const store = new SqliteWatchedProjectMonitorStore(databasePath, now);
    const monitor = new WatchedProjectMonitorService(
      [limited],
      { inspect: async () => snapshot(["root_missing"], current.toISOString()) },
      store,
      now,
    );
    await monitor.runDue();
    const notifications = new WatchedProjectNotificationService([limited], store, now);
    const fail = async () => { throw new Error("not persisted"); };
    await notifications.drainPending(fail);
    current = new Date(current.getTime() + 60_000);
    await notifications.drainPending(fail);
    expect(monitor.get("portfolio").notifications[0]).toMatchObject({
      status: "abandoned",
      attempts: 2,
      nextAttemptAt: null,
    });
    current = new Date(current.getTime() + 24 * 60 * 60_000);
    expect(await notifications.drainPending(async () => undefined)).toEqual({ delivered: 0, failed: 0 });
    monitor.close();
  });

  it("allows only one connection to claim a pending notification", async () => {
    const databasePath = await temporaryDatabase();
    const current = new Date("2026-08-26T12:00:00.000Z");
    const now = () => current;
    const firstStore = new SqliteWatchedProjectMonitorStore(databasePath, now);
    const monitor = new WatchedProjectMonitorService(
      [project()],
      { inspect: async () => snapshot(["plan_stale"], current.toISOString()) },
      firstStore,
      now,
    );
    await monitor.runDue();
    const secondStore = new SqliteWatchedProjectMonitorStore(databasePath, now);
    expect(firstStore.claimNotification(current)).not.toBeNull();
    expect(secondStore.claimNotification(current)).toBeNull();
    secondStore.close();
    monitor.close();
  });

  it("suppresses notification intents from manual checks", async () => {
    const databasePath = await temporaryDatabase();
    const current = new Date("2026-08-26T12:00:00.000Z");
    const store = new SqliteWatchedProjectMonitorStore(databasePath, () => current);
    const monitor = new WatchedProjectMonitorService(
      [project()],
      { inspect: async () => snapshot(["root_missing"], current.toISOString()) },
      store,
      () => current,
    );
    await monitor.runNow("portfolio");
    expect(monitor.get("portfolio").notifications).toEqual([]);
    monitor.close();
  });

  it("neutralizes Slack mentions and line breaks from a configured project label", async () => {
    const databasePath = await temporaryDatabase();
    const current = new Date("2026-08-26T12:00:00.000Z");
    const configured = { ...project(), label: "Portfolio <@UOTHER>\n<!channel>" };
    const store = new SqliteWatchedProjectMonitorStore(databasePath, () => current);
    const monitor = new WatchedProjectMonitorService(
      [configured],
      { inspect: async () => snapshot(["plan_missing"], current.toISOString()) },
      store,
      () => current,
    );
    await monitor.runDue();
    const notifications = new WatchedProjectNotificationService([configured], store, () => current);
    let text = "";
    await notifications.drainPending(async (message) => { text = message.text; });
    expect(text).toContain("Portfolio &lt;@UOTHER&gt; &lt;!channel&gt;");
    expect(text).not.toContain("<@UOTHER>");
    expect(text).not.toContain("\n");
    monitor.close();
  });
});

function project(maxAttempts = 5): WatchedProjectDefinition {
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
      notifications: { enabled: true, destination: "slack_owner_dm", maxAttempts },
    },
  };
}

function snapshot(alerts: readonly WatchedProjectAlert[], checkedAt: string): WatchedProjectSnapshot {
  return {
    id: "portfolio",
    label: "Portfolio",
    checkedAt,
    rootExists: true,
    git: { state: "available", branch: "main", revision: "abc", dirty: false, changedFileCount: 0 },
    plan: { configured: true, relativePath: "PLAN.md", exists: true, modifiedAt: checkedAt, ageDays: 0 },
    verification: { state: "not_configured", checkedAt: null },
    alerts,
  };
}

async function temporaryDatabase(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "jolene-notifications-"));
  temporaryDirectories.push(directory);
  return path.join(directory, "jolene.sqlite");
}
