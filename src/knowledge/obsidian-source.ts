import type {
  KnowledgeNamespace,
  KnowledgeResult,
  KnowledgeSearchContext,
  KnowledgeSource,
} from "./knowledge-source.js";
import {
  ObsidianVaultReader,
  type ObsidianMarkdownDocument,
} from "./obsidian-vault.js";

const MAX_EXCERPT_LENGTH = 1_600;

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
    const results = files.flatMap((file) => this.searchFile(file, terms));

    return results
      .sort((left, right) => right.score - left.score)
      .slice(0, Math.max(1, Math.min(limit, 10)));
  }

  private searchFile(
    document: ObsidianMarkdownDocument,
    terms: readonly string[],
  ): KnowledgeResult[] {
    const lines = document.content.split(/\r?\n/);
    const relativeLower = document.relativePath.toLowerCase();
    const pathScore = terms.reduce(
      (score, term) => score + (relativeLower.includes(term) ? 3 : 0),
      0,
    );

    return sections(lines).flatMap((section) => {
      const headingLower = section.heading.toLowerCase();
      const contentLower = section.lines.join("\n").toLowerCase();
      const headingScore = terms.reduce(
        (score, term) => score + countOccurrences(headingLower, term) * 7,
        0,
      );
      const contentScore = terms.reduce(
        (score, term) => score + countOccurrences(contentLower, term) * 4,
        0,
      );
      const score = pathScore + headingScore + contentScore;
      if (score === 0) return [];

      return [{
        namespace: namespaceForPath(document.relativePath),
        notePath: document.relativePath,
        heading: section.heading,
        excerpt: section.lines.join("\n").trim().slice(0, MAX_EXCERPT_LENGTH),
        modifiedAt: document.modifiedAt,
        score,
      } satisfies KnowledgeResult];
    });
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

interface MarkdownSection {
  readonly heading: string;
  readonly lines: readonly string[];
}

function sections(lines: readonly string[]): MarkdownSection[] {
  const found: Array<{ heading: string; lines: string[] }> = [];
  let current = { heading: "Document", lines: [] as string[] };

  for (const line of lines) {
    const match = /^(#{1,6})\s+(.+)$/.exec(line.trim());
    if (match?.[1] && match[2] && match[1].length <= 2) {
      if (hasSectionContent(current)) found.push(current);
      current = { heading: match[2].trim(), lines: [line] };
      continue;
    }
    current.lines.push(line);
  }
  if (hasSectionContent(current)) found.push(current);

  return found;
}

function hasSectionContent(section: { heading: string; lines: string[] }): boolean {
  const contentLines = section.heading === "Document"
    ? section.lines
    : section.lines.slice(1);
  return contentLines.some((value) => value.trim());
}

function namespaceForPath(relativePath: string): KnowledgeNamespace {
  const topLevel = relativePath.split("/")[0]?.toLowerCase() ?? "";
  if (topLevel.startsWith("01 career")) return "career";
  if (topLevel.startsWith("02 projects")) return "projects";
  if (topLevel.startsWith("03 engineering")) return "engineering";
  if (topLevel.startsWith("06 personal")) return "personal";
  if (topLevel.startsWith("07 sources")) return "sources";
  return "other";
}
