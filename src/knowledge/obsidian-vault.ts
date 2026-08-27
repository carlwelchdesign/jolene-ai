import { promises as fs } from "node:fs";
import path from "node:path";

const DEFAULT_MAX_FILE_BYTES = 1_000_000;

export interface ObsidianMarkdownDocument {
  readonly absolutePath: string;
  readonly relativePath: string;
  readonly content: string;
  readonly modifiedAt: string;
}

export interface ObsidianVaultReaderOptions {
  readonly vaultRoot: string;
  readonly allowlist: readonly string[];
  readonly maxFileBytes?: number;
}

export class ObsidianVaultReader {
  readonly root: string;
  readonly allowlist: readonly string[];
  private readonly maxFileBytes: number;

  constructor(options: ObsidianVaultReaderOptions) {
    this.root = path.resolve(options.vaultRoot);
    this.allowlist = options.allowlist
      .map(normalizeVaultRelativePath)
      .filter(Boolean);
    if (this.allowlist.some((entry) => !isSafeRelativePath(entry))) {
      throw new RangeError("Obsidian allowlist entries must stay inside the vault.");
    }
    this.maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
    if (!Number.isInteger(this.maxFileBytes) || this.maxFileBytes < 1) {
      throw new RangeError("Obsidian maximum file size must be a positive integer.");
    }
  }

  async listMarkdownDocuments(): Promise<readonly ObsidianMarkdownDocument[]> {
    if (this.allowlist.length === 0) return [];
    const files = await this.collectMarkdownFiles(this.root);
    const documents = await Promise.all(files.sort().map(async (absolutePath) => {
      const file = await fs.stat(absolutePath);
      if (file.size > this.maxFileBytes) return null;
      const relativePath = normalizeVaultRelativePath(
        path.relative(this.root, absolutePath),
      );
      return {
        absolutePath,
        relativePath,
        content: await fs.readFile(absolutePath, "utf8"),
        modifiedAt: file.mtime.toISOString(),
      } satisfies ObsidianMarkdownDocument;
    }));
    return documents.filter(
      (document): document is ObsidianMarkdownDocument => document !== null,
    );
  }

  private async collectMarkdownFiles(directory: string): Promise<string[]> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const absolute = path.join(directory, entry.name);
      const relative = normalizeVaultRelativePath(path.relative(this.root, absolute));
      if (entry.isDirectory()) {
        if (this.couldContainAllowedPath(relative)) {
          files.push(...(await this.collectMarkdownFiles(absolute)));
        }
      } else if (
        entry.isFile() &&
        entry.name.toLowerCase().endsWith(".md") &&
        this.isAllowed(relative)
      ) {
        files.push(absolute);
      }
    }
    return files;
  }

  private isAllowed(relative: string): boolean {
    return this.allowlist.some(
      (prefix) => relative === prefix || relative.startsWith(`${prefix}/`),
    );
  }

  private couldContainAllowedPath(relative: string): boolean {
    return this.allowlist.some(
      (prefix) =>
        relative === prefix ||
        relative.startsWith(`${prefix}/`) ||
        prefix.startsWith(`${relative}/`),
    );
  }
}

export function normalizeVaultRelativePath(value: string): string {
  return value
    .replaceAll(path.sep, "/")
    .replace(/^\.\//, "")
    .replace(/\/$/, "");
}

function isSafeRelativePath(value: string): boolean {
  if (!value || value.startsWith("/") || path.posix.isAbsolute(value)) return false;
  const normalized = path.posix.normalize(value);
  return normalized !== ".." && !normalized.startsWith("../");
}
