import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  FilePublicModelRequestBudget,
  InMemoryPublicModelRequestBudget,
} from "../src/public/public-model-request-budget.js";

const temporaryDirectories: string[] = [];

describe("InMemoryPublicModelRequestBudget", () => {
  it("bounds requests inside a runtime and resets the window", async () => {
    let now = new Date("2026-08-27T12:00:00.000Z");
    const budget = new InMemoryPublicModelRequestBudget({
      maxRequestsPerWindow: 2,
      windowMilliseconds: 1_000,
      now: () => now,
    });

    await expect(budget.reserve()).resolves.toBe(true);
    await expect(budget.reserve()).resolves.toBe(true);
    await expect(budget.reserve()).resolves.toBe(false);
    now = new Date("2026-08-27T12:00:01.000Z");
    await expect(budget.reserve()).resolves.toBe(true);
  });
});

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

describe("FilePublicModelRequestBudget", () => {
  it("persists a strict aggregate request cap across restart", async () => {
    const filePath = await budgetPath();
    const budget = createBudget(filePath, 2);
    await budget.initialize();

    expect(await budget.reserve()).toBe(true);
    expect(await budget.reserve()).toBe(true);
    expect(await budget.reserve()).toBe(false);
    expect(await createBudget(filePath, 2).reserve()).toBe(false);

    const stored = JSON.parse(await readFile(filePath, "utf8"));
    expect(Object.keys(stored).sort()).toEqual([
      "requestCount",
      "schemaVersion",
      "windowStartedAt",
    ]);
    expect(stored.requestCount).toBe(2);
    expect((await stat(filePath)).mode & 0o777).toBe(0o600);
  });

  it("starts a fresh budget window after one day", async () => {
    const filePath = await budgetPath();
    let now = new Date("2026-08-26T18:00:00.000Z");
    const budget = createBudget(filePath, 1, () => now);
    await budget.initialize();
    expect(await budget.reserve()).toBe(true);
    expect(await budget.reserve()).toBe(false);

    now = new Date("2026-08-27T18:00:00.000Z");
    expect(await budget.reserve()).toBe(true);
    expect(JSON.parse(await readFile(filePath, "utf8"))).toMatchObject({
      windowStartedAt: now.toISOString(),
      requestCount: 1,
    });
  });

  it("serializes concurrent reservations without exceeding the cap", async () => {
    const filePath = await budgetPath();
    const budget = createBudget(filePath, 5);
    await budget.initialize();

    const reservations = await Promise.all(
      Array.from({ length: 20 }, () => budget.reserve()),
    );
    expect(reservations.filter(Boolean)).toHaveLength(5);
  });

  it("fails closed for corrupt state and invalid limits", async () => {
    const filePath = await budgetPath();
    const budget = createBudget(filePath, 1);
    await budget.initialize();
    await writeFile(filePath, JSON.stringify({ requestCount: "private" }));

    await expect(budget.reserve()).rejects.toMatchObject({
      name: "PublicModelBudgetUnavailableError",
    });
    expect(() => createBudget(filePath, 0)).toThrow();
  });
});

function createBudget(
  filePath: string,
  maxRequestsPerWindow: number,
  now: () => Date = () => new Date("2026-08-26T18:00:00.000Z"),
): FilePublicModelRequestBudget {
  return new FilePublicModelRequestBudget({
    filePath,
    maxRequestsPerWindow,
    windowMilliseconds: 24 * 60 * 60 * 1_000,
    now,
  });
}

async function budgetPath(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "jolene-model-budget-"));
  temporaryDirectories.push(directory);
  return path.join(directory, "budget.json");
}
