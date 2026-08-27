import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PrivateBriefingService,
  renderPrivateBriefing,
} from "../src/application/private-briefing-service.js";
import { CanonicalPrivateBriefingSource } from "../src/application/private-briefing-source.js";
import type {
  PrivateBriefingPolicy,
  PrivateBriefingSnapshot,
  PrivateBriefingSource,
} from "../src/domain/private-briefing.js";
import { SqlitePrivateBriefingStore } from "../src/persistence/sqlite-private-briefing-store.js";

const temporaryDirectories: string[] = [];
const scope = { actorId: "carl", workspaceId: "personal" };

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true })
  ));
});

describe("durable private owner briefings", () => {
  it("does not send on activation, delivers once when due, and survives restart", async () => {
    const databasePath = await temporaryDatabase();
    let current = new Date("2026-08-26T14:59:00.000Z");
    const now = () => current;
    const post = vi.fn(async () => undefined);
    let service = createService(databasePath, now, source("First"));

    expect(service.view()).toMatchObject({ status: "active", deliveryCount: 0 });
    expect(await service.drainPending(post)).toEqual({ delivered: 0, failed: 0 });
    expect(post).not.toHaveBeenCalled();

    current = new Date("2026-08-26T15:00:00.000Z");
    expect(await service.drainPending(post)).toEqual({ delivered: 1, failed: 0 });
    expect(post).toHaveBeenCalledOnce();
    service.close();

    current = new Date("2026-08-26T15:05:00.000Z");
    service = createService(databasePath, now, source("Changed after restart"));
    expect(await service.drainPending(post)).toEqual({ delivered: 0, failed: 0 });
    expect(service.view()).toMatchObject({ deliveryCount: 1, deliveriesToday: 1 });
    service.close();
  });

  it("preserves an overdue occurrence across restart instead of resetting the schedule", async () => {
    const databasePath = await temporaryDatabase();
    let current = new Date("2026-08-26T14:59:00.000Z");
    const now = () => current;
    createService(databasePath, now, source("Overdue task")).close();

    current = new Date("2026-08-26T15:05:00.000Z");
    const restarted = createService(databasePath, now, source("Overdue task"));
    const post = vi.fn(async (_notification: { notificationId: string; text: string }) => undefined);
    expect(restarted.view().nextRunAt).toBe("2026-08-26T15:00:00.000Z");
    expect(await restarted.drainPending(post)).toEqual({ delivered: 1, failed: 0 });
    expect(post).toHaveBeenCalledOnce();
    restarted.close();
  });

  it("retries the exact stored message", async () => {
    const databasePath = await temporaryDatabase();
    let current = new Date("2026-08-26T14:59:00.000Z");
    const now = () => current;
    let title = "Original task";
    const dynamicSource: PrivateBriefingSource = { snapshot: () => snapshot(title, current) };
    const service = createService(databasePath, now, dynamicSource, { maxAttempts: 2 });
    current = new Date("2026-08-26T15:00:00.000Z");
    const failed = vi.fn(async (_notification: { notificationId: string; text: string }) => {
      throw new TypeError("offline secret detail");
    });
    expect(await service.drainPending(failed)).toEqual({ delivered: 0, failed: 1 });
    const originalMessage = failed.mock.calls[0]?.[0].text;

    title = "New task must not replace the retry";
    current = new Date("2026-08-26T15:01:00.000Z");
    const delivered = vi.fn(async (_notification: { notificationId: string; text: string }) => undefined);
    expect(await service.drainPending(delivered)).toEqual({ delivered: 1, failed: 0 });
    expect(delivered.mock.calls[0]?.[0].text).toBe(originalMessage);
    expect(delivered.mock.calls[0]?.[0].text).not.toContain(title);
    service.close();
  });

  it("allows only one claimant across concurrent SQLite connections", async () => {
    const databasePath = await temporaryDatabase();
    let current = new Date("2026-08-26T14:59:00.000Z");
    const now = () => current;
    const first = new SqlitePrivateBriefingStore(databasePath, now);
    const second = new SqlitePrivateBriefingStore(databasePath, now);
    const next = new Date("2026-08-26T15:00:00.000Z");
    first.reconcile(scope, policy(), current, next);
    second.reconcile(scope, policy(), current, next);
    current = next;
    const following = new Date("2026-08-27T15:00:00.000Z");
    const claims = [
      first.claim(scope, policy(), current, following, "one"),
      second.claim(scope, policy(), current, following, "two"),
    ].filter(Boolean);
    expect(claims).toHaveLength(1);
    first.close();
    second.close();
  });

  it("uses only bounded titles, aggregate approvals, labels, and alert codes", () => {
    const source = new CanonicalPrivateBriefingSource(
      {
        review: () => ({
          totalTaskCount: 1,
          matchingTaskCount: 1,
          returnedTaskCount: 1,
          truncated: false,
          statusCounts: {
            pending: 0,
            running: 0,
            approval_needed: 1,
            failed: 0,
            retryable: 0,
            completed: 0,
            cancelled: 0,
          },
          tasks: [{
            id: "task-id",
            title: "Review <@UOTHER> offer",
            objective: "PRIVATE OBJECTIVE SECRET",
            objectiveTruncated: false,
            status: "approval_needed",
            updatedAt: "2026-08-26T12:00:00.000Z",
            workflows: [{
              id: "workflow-id",
              kind: "briefing",
              status: "awaiting_review",
              currentStepId: "draft",
              updatedAt: "2026-08-26T12:00:00.000Z",
            }],
          }],
        }),
      },
      {
        list: () => [{
          projectId: "portfolio",
          status: "active",
          nextRunAt: null,
          lastRunAt: null,
          runCount: 1,
          runsToday: 1,
          policy: {
            enabled: true,
            cadenceMinutes: 60,
            maxRunsPerDay: 24,
            stopAfterRuns: 720,
            historyLimit: 90,
            notifications: { enabled: true, destination: "slack_owner_dm", maxAttempts: 5 },
          },
          history: [{
            id: "run-id",
            projectId: "portfolio",
            trigger: "scheduled",
            status: "succeeded",
            startedAt: "2026-08-26T12:00:00.000Z",
            completedAt: "2026-08-26T12:00:00.000Z",
            errorCode: null,
            snapshot: {
              id: "portfolio",
              label: "Carl Portfolio",
              checkedAt: "2026-08-26T12:00:00.000Z",
              rootExists: true,
              git: { state: "available", branch: "main", revision: "private-revision", dirty: true, changedFileCount: 1 },
              plan: { configured: true, relativePath: "/private/PLAN.md", exists: true, modifiedAt: null, ageDays: null },
              verification: { state: "not_configured", checkedAt: null },
              alerts: ["uncommitted_changes"],
            },
          }],
          notifications: [],
        }],
      },
      {
        listProposals: () => [{ content: "PRIVATE APPROVAL PAYLOAD" }] as never,
      },
      () => new Date("2026-08-26T12:00:00.000Z"),
    );
    const briefing = source.snapshot(scope);
    const serialized = JSON.stringify(briefing);
    const message = renderPrivateBriefing(briefing);
    expect(serialized).not.toContain("PRIVATE OBJECTIVE SECRET");
    expect(serialized).not.toContain("PRIVATE APPROVAL PAYLOAD");
    expect(serialized).not.toContain("/private/PLAN.md");
    expect(serialized).not.toContain("private-revision");
    expect(message).toContain("External actions awaiting your approval: 1");
    expect(message).toContain("Review &lt;＠UOTHER&gt; offer");
    expect(message).not.toContain("<@UOTHER>");
  });
});

function createService(
  databasePath: string,
  now: () => Date,
  briefingSource: PrivateBriefingSource,
  overrides: Partial<PrivateBriefingPolicy> = {},
): PrivateBriefingService {
  return new PrivateBriefingService(
    policy(overrides),
    new SqlitePrivateBriefingStore(databasePath, now),
    briefingSource,
    scope,
    now,
  );
}

function source(title: string): PrivateBriefingSource {
  return { snapshot: () => snapshot(title, new Date("2026-08-26T12:00:00.000Z")) };
}

function snapshot(title: string, now: Date): PrivateBriefingSnapshot {
  return {
    generatedAt: now.toISOString(),
    taskStatusCounts: {
      pending: 0,
      running: 1,
      approval_needed: 0,
      failed: 0,
      retryable: 0,
      completed: 0,
      cancelled: 0,
    },
    attentionTasks: [],
    activeTasks: [{ title, status: "running" }],
    workflowStatusCounts: { active: 1, awaiting_review: 0, completed: 0, cancelled: 0 },
    projects: [],
    pendingActionApprovalCount: 0,
    truncated: false,
  };
}

function policy(overrides: Partial<PrivateBriefingPolicy> = {}): PrivateBriefingPolicy {
  return {
    enabled: true,
    destination: "slack_owner_dm",
    frequency: "daily",
    dayOfWeek: null,
    localHour: 8,
    localMinute: 0,
    timeZone: "America/Los_Angeles",
    maxDeliveriesPerDay: 1,
    stopAfterDeliveries: 365,
    historyLimit: 90,
    maxAttempts: 5,
    ...overrides,
  };
}

async function temporaryDatabase(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "jolene-briefing-"));
  temporaryDirectories.push(directory);
  return path.join(directory, "jolene.sqlite");
}
