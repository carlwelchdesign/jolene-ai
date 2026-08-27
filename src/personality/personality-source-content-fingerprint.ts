import { createHash } from "node:crypto";

export type NormalizedTranscriptFingerprintMethod =
  | "blank-on-blank-transcript-paragraphs-v1"
  | "wired-indexed-transcript-captions-v1";

export interface TranscriptContentFingerprint {
  readonly fingerprint: string;
  readonly segmentCount: number;
}

export function fingerprintNormalizedTranscript(
  method: NormalizedTranscriptFingerprintMethod,
  html: string,
): TranscriptContentFingerprint {
  const segments = method === "blank-on-blank-transcript-paragraphs-v1"
    ? extractBlankOnBlankTranscript(html)
    : extractWiredTranscript(html);
  if (segments.length === 0) throw new Error(`No transcript segments found for ${method}`);
  const hash = createHash("sha256");
  for (const segment of segments) {
    const bytes = Buffer.from(segment, "utf8");
    const length = Buffer.alloc(8);
    length.writeBigUInt64BE(BigInt(bytes.length));
    hash.update(length);
    hash.update(bytes);
  }
  return {
    fingerprint: `sha256:${hash.digest("hex")}`,
    segmentCount: segments.length,
  };
}

function extractBlankOnBlankTranscript(html: string): readonly string[] {
  const block = extractBalancedDivByClass(html, "transcript");
  return [...block.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => normalizeVisibleText(match[1] ?? ""))
    .filter(Boolean);
}

function extractWiredTranscript(html: string): readonly string[] {
  const indexed = [...html.matchAll(
    /<p\b[^>]*data-testid=["']transcript-caption-(\d+)["'][^>]*>([\s\S]*?)<\/p>/gi,
  )].map((match) => ({
    index: Number.parseInt(match[1] ?? "", 10),
    text: normalizeVisibleText(match[2] ?? ""),
  }));
  indexed.sort((left, right) => left.index - right.index);
  indexed.forEach((entry, index) => {
    if (entry.index !== index || entry.text.length === 0) {
      throw new Error("WIRED transcript captions are missing, duplicated, or empty");
    }
  });
  return indexed.map((entry) => entry.text);
}

function extractBalancedDivByClass(html: string, className: string): string {
  const opening = new RegExp(
    `<div\\b[^>]*class=["'][^"']*\\b${escapeRegex(className)}\\b[^"']*["'][^>]*>`,
    "i",
  ).exec(html);
  if (!opening || opening.index === undefined) {
    throw new Error(`Missing ${className} transcript container`);
  }
  const contentStart = opening.index + opening[0].length;
  const tags = /<\/?div\b[^>]*>/gi;
  tags.lastIndex = contentStart;
  let depth = 1;
  for (let tag = tags.exec(html); tag; tag = tags.exec(html)) {
    depth += tag[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return html.slice(contentStart, tag.index);
  }
  throw new Error(`Unclosed ${className} transcript container`);
}

function normalizeVisibleText(markup: string): string {
  return decodeHtmlEntities(markup
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtmlEntities(value: string): string {
  const named: Readonly<Record<string, string>> = {
    amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"',
  };
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, token: string) => {
    if (token.startsWith("#x") || token.startsWith("#X")) {
      return String.fromCodePoint(Number.parseInt(token.slice(2), 16));
    }
    if (token.startsWith("#")) return String.fromCodePoint(Number.parseInt(token.slice(1), 10));
    return named[token.toLowerCase()] ?? entity;
  });
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
