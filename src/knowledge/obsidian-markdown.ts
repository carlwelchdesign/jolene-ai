import path from "node:path";

import type { CareerSourceHeading } from "../domain/career-evidence.js";

export interface ParsedObsidianSection {
  readonly logicalKey: string;
  readonly heading: string;
  readonly headingPath: readonly string[];
  readonly level: number;
  readonly content: string;
}

export interface ParsedObsidianCareerNote {
  readonly title: string;
  readonly tags: readonly string[];
  readonly aliases: readonly string[];
  readonly wikiLinks: readonly string[];
  readonly markdownLinks: readonly string[];
  readonly headings: readonly CareerSourceHeading[];
  readonly frontmatterKeys: readonly string[];
  readonly documentDate: string | null;
  readonly importEnabled: boolean;
  readonly sections: readonly ParsedObsidianSection[];
}

type FrontmatterValue = string | readonly string[];

export function parseObsidianCareerNote(
  relativePath: string,
  markdown: string,
): ParsedObsidianCareerNote {
  const lines = markdown.split(/\r?\n/);
  const { values, keys, bodyStart } = parseFrontmatter(lines);
  const bodyLines = lines.slice(bodyStart);
  const headings = bodyLines.flatMap((line) => {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    return match?.[1] && match[2]
      ? [{ level: match[1].length, text: match[2].trim() }]
      : [];
  });
  const title = headings.find((heading) => heading.level === 1)?.text ??
    path.basename(relativePath, path.extname(relativePath));
  const body = bodyLines.join("\n");
  const tags = uniqueSorted([
    ...frontmatterList(values.get("tags")),
    ...extractInlineTags(body),
  ]);
  const aliases = uniqueSorted(frontmatterList(values.get("aliases")));
  const documentDate = firstScalar(values, ["updated", "date", "created"]);
  const importValue = firstScalar(values, [
    "jolene_career_import",
    "jolene-career-import",
  ]);

  return {
    title,
    tags,
    aliases,
    wikiLinks: uniqueSorted(extractWikiLinks(body)),
    markdownLinks: uniqueSorted(extractMarkdownLinks(body)),
    headings,
    frontmatterKeys: uniqueSorted(keys),
    documentDate,
    importEnabled: importValue?.toLowerCase() !== "false",
    sections: parseSections(bodyLines, title),
  };
}

function parseFrontmatter(lines: readonly string[]): {
  readonly values: ReadonlyMap<string, FrontmatterValue>;
  readonly keys: readonly string[];
  readonly bodyStart: number;
} {
  if (lines[0]?.trim() !== "---") {
    return { values: new Map(), keys: [], bodyStart: 0 };
  }
  const closing = lines.slice(1).findIndex((line) => line.trim() === "---");
  if (closing < 0) {
    return { values: new Map(), keys: [], bodyStart: 0 };
  }
  const end = closing + 1;
  const values = new Map<string, FrontmatterValue>();
  let activeListKey: string | null = null;
  for (const line of lines.slice(1, end)) {
    const listItem = /^\s+-\s+(.+?)\s*$/.exec(line);
    if (listItem?.[1] && activeListKey) {
      const current = values.get(activeListKey);
      values.set(activeListKey, [
        ...(Array.isArray(current) ? current : []),
        unquote(listItem[1]),
      ]);
      continue;
    }
    const entry = /^([A-Za-z0-9_-]+):\s*(.*?)\s*$/.exec(line);
    if (!entry?.[1]) {
      activeListKey = null;
      continue;
    }
    const key = entry[1].toLowerCase();
    const raw = entry[2] ?? "";
    if (!raw) {
      values.set(key, []);
      activeListKey = key;
    } else {
      values.set(key, parseInlineValue(raw));
      activeListKey = null;
    }
  }
  return {
    values,
    keys: Array.from(values.keys()),
    bodyStart: end + 1,
  };
}

function parseInlineValue(value: string): FrontmatterValue {
  const trimmed = value.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .map((entry) => unquote(entry.trim()))
      .filter(Boolean);
  }
  return unquote(trimmed);
}

function unquote(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function frontmatterList(value: FrontmatterValue | undefined): readonly string[] {
  if (Array.isArray(value)) return value;
  return typeof value === "string" && value.trim() ? [value] : [];
}

function firstScalar(
  values: ReadonlyMap<string, FrontmatterValue>,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = values.get(key);
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function extractInlineTags(body: string): readonly string[] {
  return Array.from(body.matchAll(/(?:^|\s)#([A-Za-z0-9][A-Za-z0-9/_-]*)/gm))
    .flatMap((match) => match[1] ? [match[1]] : []);
}

function extractWikiLinks(body: string): readonly string[] {
  return Array.from(body.matchAll(/!?\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g))
    .flatMap((match) => match[1]?.trim() ? [match[1].trim()] : []);
}

function extractMarkdownLinks(body: string): readonly string[] {
  return Array.from(body.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g))
    .flatMap((match) => match[1]?.trim() ? [match[1].trim()] : []);
}

function parseSections(
  lines: readonly string[],
  documentTitle: string,
): readonly ParsedObsidianSection[] {
  const sections: ParsedObsidianSection[] = [];
  const headingStack: string[] = [];
  const keyCounts = new Map<string, number>();
  let heading = documentTitle;
  let level = 1;
  let body: string[] = [];

  const flush = () => {
    const content = body.join("\n").trim();
    body = [];
    if (!content) return;
    const activeHeadingPath = headingStack.filter(Boolean);
    const headingPath = activeHeadingPath.length > 0
      ? activeHeadingPath
      : [documentTitle];
    const baseKey = `section:${headingPath.map(slug).filter(Boolean).join(":") || "document"}`;
    const count = keyCounts.get(baseKey) ?? 0;
    keyCounts.set(baseKey, count + 1);
    sections.push({
      logicalKey: count === 0 ? baseKey : `${baseKey}:${count + 1}`,
      heading,
      headingPath,
      level,
      content,
    });
  };

  for (const line of lines) {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (!match?.[1] || !match[2]) {
      body.push(line);
      continue;
    }
    flush();
    level = match[1].length;
    heading = match[2].trim();
    headingStack.length = level - 1;
    headingStack[level - 1] = heading;
  }
  flush();
  return sections;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
    .sort((left, right) => left.localeCompare(right));
}
