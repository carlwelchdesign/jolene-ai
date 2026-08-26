import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { WatchedProjectService } from "../src/application/watched-project-service.js";
import { parseWatchedProjects } from "../src/config.js";
import { WatchedProjectNotFoundError } from "../src/domain/watched-project.js";
import { LocalWatchedProjectInspector } from "../src/projects/local-watched-project-inspector.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("watched projects", () => {
  it("reports plan freshness and dirty Git state without modifying the project", async () => {
    const rootPath = await createTemporaryDirectory();
    await fs.mkdir(path.join(rootPath, ".git"));
    const planPath = path.join(rootPath, "PORTFOLIO_SITE_PLAN.md");
    await fs.writeFile(planPath, "# Portfolio plan\n", "utf8");
    await fs.utimes(
      planPath,
      new Date("2026-08-01T12:00:00.000Z"),
      new Date("2026-08-01T12:00:00.000Z"),
    );

    const inspector = new LocalWatchedProjectInspector({
      now: () => new Date("2026-08-25T12:00:00.000Z"),
      runGit: async (_rootPath, args) =>
        args[0] === "status"
          ? "## main...origin/main\n M PORTFOLIO_SITE_PLAN.md\n"
          : "abc123\n",
    });

    const snapshot = await inspector.inspect({
      id: "carl-welch-portfolio",
      label: "Carl Welch Portfolio",
      rootPath,
      planFile: "PORTFOLIO_SITE_PLAN.md",
      reviewWindowDays: 14,
    });

    expect(snapshot).toMatchObject({
      rootExists: true,
      git: {
        state: "available",
        branch: "main",
        revision: "abc123",
        dirty: true,
        changedFileCount: 1,
      },
      plan: {
        exists: true,
        ageDays: 24,
      },
      verification: { state: "not_configured" },
      alerts: ["plan_stale", "uncommitted_changes"],
    });
    expect(await fs.readFile(planPath, "utf8")).toBe("# Portfolio plan\n");
  });

  it("makes missing roots and absent Git boundaries explicit", async () => {
    const missingRoot = path.join(await createTemporaryDirectory(), "missing");
    const inspector = new LocalWatchedProjectInspector({
      now: () => new Date("2026-08-25T12:00:00.000Z"),
    });

    const snapshot = await inspector.inspect({
      id: "missing-project",
      label: "Missing Project",
      rootPath: missingRoot,
      planFile: "PLAN.md",
      reviewWindowDays: 30,
    });

    expect(snapshot).toMatchObject({
      rootExists: false,
      git: { state: "not_repository" },
      plan: { exists: false },
      alerts: ["root_missing", "plan_missing"],
    });
  });

  it("exposes public-safe summaries and rejects unknown project IDs", async () => {
    const inspector = new LocalWatchedProjectInspector();
    const service = new WatchedProjectService(
      [
        {
          id: "portfolio",
          label: "Portfolio",
          rootPath: "/private/local/path",
          planFile: "PLAN.md",
          reviewWindowDays: 30,
        },
      ],
      inspector,
    );

    expect(service.list()).toEqual([
      {
        id: "portfolio",
        label: "Portfolio",
        planFile: "PLAN.md",
        reviewWindowDays: 30,
      },
    ]);
    expect(JSON.stringify(service.list())).not.toContain("/private/local/path");
    await expect(service.snapshot("unknown")).rejects.toBeInstanceOf(
      WatchedProjectNotFoundError,
    );
  });

  it("validates configured IDs, plan boundaries, and duplicate entries", () => {
    const parsed = parseWatchedProjects(
      JSON.stringify([
        {
          id: "carl-welch-portfolio",
          label: "Carl Welch Portfolio",
          rootPath: "/tmp/carl-welch-portfolio",
          planFile: "PORTFOLIO_SITE_PLAN.md",
        },
      ]),
    );

    expect(parsed[0]).toMatchObject({
      id: "carl-welch-portfolio",
      reviewWindowDays: 30,
    });
    expect(() =>
      parseWatchedProjects(
        JSON.stringify([
          {
            id: "portfolio",
            label: "Portfolio",
            rootPath: "/tmp/portfolio",
            planFile: "../outside.md",
          },
        ]),
      ),
    ).toThrow();
    expect(() =>
      parseWatchedProjects(
        JSON.stringify([
          { id: "portfolio", label: "One", rootPath: "/tmp/one" },
          { id: "portfolio", label: "Two", rootPath: "/tmp/two" },
        ]),
      ),
    ).toThrow();
  });
});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "jolene-watch-"));
  temporaryDirectories.push(directory);
  return directory;
}
