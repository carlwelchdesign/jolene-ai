import { promises as fs } from "node:fs";
import path from "node:path";

import type {
  KnowledgeResult,
  KnowledgeSearchContext,
  KnowledgeSource,
} from "./knowledge-source.js";

const MAX_EXCERPT_LENGTH = 700;
const MAX_FILE_BYTES = 1_000_000;

export interface ObsidianSourceOptions {
  readonly vaultRoot: string;
  readonly allowlist: readonly string[];
}

export class ObsidianKnowledgeSource implements KnowledgeSource {
  private readonly root: string;
  private readonly allowlist: readonly string[];

  constructor(options: ObsidianSourceOptions) {
    this.root = path.resolve(options.vaultRoot);
    this.allowlist = options.allowlist
      .map(normalizeRelativePath)
      .filter((entry) => entry.length > 0);
  }

  async search(
    query: string,
    context: KnowledgeSearchContext,
    limit = 5,
  ): Promise<KnowledgeResult[]> {
    if (!context.channelIsPrivate || this.allowlist.length === 0) {
      return [];
    }

    const terms = tokenize(query);
    if (terms.length === 0) {
      return [];
    }

    const files = await this.collectMarkdownFiles(this.root);
    const results = await Promise.all(
      files.map((file) => this.searchFile(file, terms)),
    );

    return results
      .filter((result): result is KnowledgeResult => result !== null)
      .sort((left, right) => right.score - left.score)
      .slice(0, Math.max(1, Math.min(limit, 10)));
  }

  private async collectMarkdownFiles(directory: string): Promise<string[]> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
      if (entry.name.startsWith(".")) {
        continue;
      }

      const absolute = path.join(directory, entry.name);
      const relative = normalizeRelativePath(path.relative(this.root, absolute));

      if (entry.isDirectory()) {
        if (this.couldContainAllowedPath(relative)) {
          files.push(...(await this.collectMarkdownFiles(absolute)));
        }
        continue;
      }

      if (
        entry.isFile() &&
        entry.name.toLowerCase().endsWith(".md") &&
        this.isAllowed(relative)
      ) {
        files.push(absolute);
      }
    }

    return files;
  }

  private async searchFile(
    absolutePath: string,
    terms: readonly string[],
  ): Promise<KnowledgeResult | null> {
    const stat = await fs.stat(absolutePath);
    if (stat.size > MAX_FILE_BYTES) {
      return null;
    }

    const content = await fs.readFile(absolutePath, "utf8");
    const lines = content.split(/\r?\n/);
    const relative = normalizeRelativePath(path.relative(this.root, absolutePath));
    const relativeLower = relative.toLowerCase();

    let bestLine = -1;
    let bestScore = 0;

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      const lower = line.toLowerCase();
      const lineScore = terms.reduce(
        (score, term) => score + countOccurrences(lower, term) * 4,
        0,
      );
      const pathScore = terms.reduce(
        (score, term) => score + (relativeLower.includes(term) ? 3 : 0),
        0,
      );
      const score = lineScore + pathScore;

      if (score > bestScore) {
        bestLine = index;
        bestScore = score;
      }
    }

    if (bestLine < 0 || bestScore === 0) {
      return null;
    }

    const start = Math.max(0, bestLine - 1);
    const end = Math.min(lines.length, bestLine + 2);
    const excerpt = lines
      .slice(start, end)
      .join("\n")
      .trim()
      .slice(0, MAX_EXCERPT_LENGTH);

    return {
      notePath: relative,
      heading: nearestHeading(lines, bestLine),
      excerpt,
      modifiedAt: stat.mtime.toISOString(),
      score: bestScore,
    };
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

function normalizeRelativePath(value: string): string {
  return value
    .replaceAll(path.sep, "/")
    .replace(/^\.\//, "")
    .replace(/\/$/, "");
}

function tokenize(query: string): string[] {
  return Array.from(
    new Set(
      query
        .toLowerCase()
        .match(/[a-z0-9][a-z0-9_-]+/g)
        ?.filter((term) => term.length >= 3) ?? [],
    ),
  ).slice(0, 12);
}

function countOccurrences(text: string, term: string): number {
  let count = 0;
  let offset = 0;

  while ((offset = text.indexOf(term, offset)) !== -1) {
    count += 1;
    offset += term.length;
  }

  return count;
}

function nearestHeading(lines: readonly string[], lineIndex: number): string {
  for (let index = lineIndex; index >= 0; index -= 1) {
    const line = lines[index]?.trim() ?? "";
    const match = /^(#{1,6})\s+(.+)$/.exec(line);
    if (match?.[2]) {
      return match[2].trim();
    }
  }

  return "Document";
}
