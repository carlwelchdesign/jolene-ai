import type {
  KnowledgeResult,
  KnowledgeSearchContext,
  KnowledgeSource,
} from "./knowledge-source.js";
import {
  ObsidianVaultReader,
  type ObsidianMarkdownDocument,
} from "./obsidian-vault.js";

const MAX_EXCERPT_LENGTH = 700;

export interface ObsidianSourceOptions {
  readonly vaultRoot: string;
  readonly allowlist: readonly string[];
}

export class ObsidianKnowledgeSource implements KnowledgeSource {
  private readonly vault: ObsidianVaultReader;

  constructor(options: ObsidianSourceOptions) {
    this.vault = new ObsidianVaultReader(options);
  }

  async search(
    query: string,
    context: KnowledgeSearchContext,
    limit = 5,
  ): Promise<KnowledgeResult[]> {
    if (!context.channelIsPrivate || this.vault.allowlist.length === 0) {
      return [];
    }

    const terms = tokenize(query);
    if (terms.length === 0) {
      return [];
    }

    const files = await this.vault.listMarkdownDocuments();
    const results = await Promise.all(
      files.map((file) => this.searchFile(file, terms)),
    );

    return results
      .filter((result): result is KnowledgeResult => result !== null)
      .sort((left, right) => right.score - left.score)
      .slice(0, Math.max(1, Math.min(limit, 10)));
  }

  private async searchFile(
    document: ObsidianMarkdownDocument,
    terms: readonly string[],
  ): Promise<KnowledgeResult | null> {
    const lines = document.content.split(/\r?\n/);
    const relativeLower = document.relativePath.toLowerCase();

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
      notePath: document.relativePath,
      heading: nearestHeading(lines, bestLine),
      excerpt,
      modifiedAt: document.modifiedAt,
      score: bestScore,
    };
  }

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
