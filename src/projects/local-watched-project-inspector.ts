import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import type {
  WatchedProjectAlert,
  WatchedProjectDefinition,
  WatchedProjectInspector,
  WatchedProjectSnapshot,
} from "../domain/watched-project.js";

const execFileAsync = promisify(execFile);

interface LocalWatchedProjectInspectorOptions {
  readonly now?: () => Date;
  readonly runGit?: (
    rootPath: string,
    args: readonly string[],
  ) => Promise<string>;
}

export class LocalWatchedProjectInspector implements WatchedProjectInspector {
  private readonly now: () => Date;
  private readonly runGit: (
    rootPath: string,
    args: readonly string[],
  ) => Promise<string>;

  constructor(options: LocalWatchedProjectInspectorOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.runGit = options.runGit ?? runGit;
  }

  async inspect(
    project: WatchedProjectDefinition,
  ): Promise<WatchedProjectSnapshot> {
    const checkedAt = this.now();
    const rootExists = await exists(project.rootPath);
    const plan = await inspectPlan(project, checkedAt);
    const git = rootExists
      ? await inspectGit(project.rootPath, this.runGit)
      : emptyGit("not_repository");
    const alerts: WatchedProjectAlert[] = [];

    if (!rootExists) alerts.push("root_missing");
    if (rootExists && git.state === "not_repository") {
      alerts.push("git_not_initialized");
    }
    if (git.state === "unavailable") alerts.push("git_unavailable");
    if (plan.configured && !plan.exists) alerts.push("plan_missing");
    if (
      plan.ageDays !== null &&
      plan.ageDays > project.reviewWindowDays
    ) {
      alerts.push("plan_stale");
    }
    if (git.dirty) alerts.push("uncommitted_changes");

    return {
      id: project.id,
      label: project.label,
      checkedAt: checkedAt.toISOString(),
      rootExists,
      git,
      plan,
      verification: { state: "not_configured", checkedAt: null },
      alerts,
    };
  }
}

async function inspectPlan(
  project: WatchedProjectDefinition,
  checkedAt: Date,
): Promise<WatchedProjectSnapshot["plan"]> {
  if (!project.planFile) {
    return {
      configured: false,
      relativePath: null,
      exists: false,
      modifiedAt: null,
      ageDays: null,
    };
  }

  try {
    const stat = await fs.stat(path.join(project.rootPath, project.planFile));
    const ageDays = Math.max(
      0,
      Math.floor((checkedAt.getTime() - stat.mtime.getTime()) / 86_400_000),
    );
    return {
      configured: true,
      relativePath: project.planFile,
      exists: stat.isFile(),
      modifiedAt: stat.mtime.toISOString(),
      ageDays,
    };
  } catch (error) {
    if (isMissing(error)) {
      return {
        configured: true,
        relativePath: project.planFile,
        exists: false,
        modifiedAt: null,
        ageDays: null,
      };
    }
    throw error;
  }
}

async function inspectGit(
  rootPath: string,
  run: (rootPath: string, args: readonly string[]) => Promise<string>,
): Promise<WatchedProjectSnapshot["git"]> {
  if (!(await exists(path.join(rootPath, ".git")))) {
    return emptyGit("not_repository");
  }

  try {
    const status = await run(rootPath, ["status", "--porcelain=v1", "--branch"]);
    const lines = status.trimEnd().split("\n").filter(Boolean);
    const branch = parseBranch(lines[0] ?? "");
    const changedFileCount = lines.filter((line) => !line.startsWith("## ")).length;
    let revision: string | null = null;
    try {
      revision = (await run(rootPath, ["rev-parse", "HEAD"])).trim() || null;
    } catch {
      // A newly initialized repository has no revision yet.
    }
    return {
      state: "available",
      branch,
      revision,
      dirty: changedFileCount > 0,
      changedFileCount,
    };
  } catch {
    return emptyGit("unavailable");
  }
}

function parseBranch(header: string): string | null {
  const value = header.replace(/^##\s*/, "");
  if (value.startsWith("No commits yet on ")) {
    return value.slice("No commits yet on ".length) || null;
  }
  if (value === "HEAD (no branch)") return null;
  return value.split("...")[0]?.trim() || null;
}

function emptyGit(
  state: "not_repository" | "unavailable",
): WatchedProjectSnapshot["git"] {
  return {
    state,
    branch: null,
    revision: null,
    dirty: null,
    changedFileCount: null,
  };
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

function isMissing(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

async function runGit(
  rootPath: string,
  args: readonly string[],
): Promise<string> {
  const result = await execFileAsync("git", ["-C", rootPath, ...args], {
    encoding: "utf8",
    timeout: 5_000,
    maxBuffer: 1_000_000,
  });
  return result.stdout;
}
