import { createHash } from "node:crypto";

import { load } from "cheerio";

export type PersonalitySourceFingerprintMethod =
  | "raw-pdf-bytes-v1"
  | "raw-vtt-bytes-v1"
  | "fresh-air-transcript-paragraphs-v1"
  | "cnn-transcript-body-paragraphs-v1"
  | "npr-station-article-body-paragraphs-v1"
  | "ted-next-data-transcript-segments-v1"
  | "blank-on-blank-transcript-paragraphs-v1"
  | "interview-magazine-speaker-paragraphs-v1"
  | "vanity-fair-proust-pairs-v1"
  | "wired-indexed-transcript-captions-v1";

export type NormalizedTranscriptFingerprintMethod = Exclude<
  PersonalitySourceFingerprintMethod,
  "raw-pdf-bytes-v1" | "raw-vtt-bytes-v1"
>;

export interface SourceContentFingerprint {
  readonly fingerprint: string;
  readonly segmentCount: number | null;
  readonly byteCount: number;
}

export function fingerprintPersonalitySourceContent(
  method: PersonalitySourceFingerprintMethod,
  bytes: Uint8Array,
): SourceContentFingerprint {
  if (method === "raw-pdf-bytes-v1" || method === "raw-vtt-bytes-v1") {
    return {
      fingerprint: digest(bytes),
      segmentCount: null,
      byteCount: bytes.byteLength,
    };
  }
  const html = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const segments = extractPersonalitySourceSegments(method, html);
  return {
    fingerprint: fingerprintSegments(segments),
    segmentCount: segments.length,
    byteCount: bytes.byteLength,
  };
}

export function fingerprintNormalizedTranscript(
  method: NormalizedTranscriptFingerprintMethod,
  html: string,
): SourceContentFingerprint {
  return fingerprintPersonalitySourceContent(method, Buffer.from(html, "utf8"));
}

export function extractPersonalitySourceSegments(
  method: NormalizedTranscriptFingerprintMethod,
  html: string,
): readonly string[] {
  let segments: readonly string[];
  const $ = load(html);
  switch (method) {
    case "fresh-air-transcript-paragraphs-v1":
      segments = directParagraphText($, ".type-segment__transcript__inner", 200);
      break;
    case "cnn-transcript-body-paragraphs-v1":
      segments = extractCnnTranscript($);
      break;
    case "npr-station-article-body-paragraphs-v1":
      segments = directParagraphText($, ".ArtP-articleBody", 10);
      break;
    case "ted-next-data-transcript-segments-v1":
      segments = extractTedTranscript(html);
      break;
    case "blank-on-blank-transcript-paragraphs-v1":
      segments = [...extractBalancedDivByClass(html, "transcript").matchAll(
        /<p\b[^>]*>([\s\S]*?)<\/p>/gi,
      )].map((match) => normalizeVisibleText(match[1] ?? "")).filter(Boolean);
      break;
    case "interview-magazine-speaker-paragraphs-v1":
      segments = extractInterviewMagazineTranscript($);
      break;
    case "vanity-fair-proust-pairs-v1":
      segments = extractVanityFairQuestionnaire($);
      break;
    case "wired-indexed-transcript-captions-v1":
      segments = extractWiredTranscript(html);
      break;
  }
  if (segments.length === 0) throw new Error(`No transcript segments found for ${method}`);
  return segments;
}

function extractInterviewMagazineTranscript($: ReturnType<typeof load>): readonly string[] {
  const containers = $("#post-body .post-block");
  if (containers.length !== 1) throw new Error("Expected one Interview Magazine post block");
  const paragraphs = containers.children("p").toArray().map((paragraph, domIndex) => ({
    domIndex,
    text: normalizeWhitespace($(paragraph).text()),
  })).filter((paragraph) => paragraph.text.length > 0);
  const label = /^(ANDY WARHOL|DOLLY PARTON|MAURA MOYNIHAN|WARHOL|PARTON|MOYNIHAN):(?:\s|$)/;
  const first = paragraphs.findIndex((paragraph) => label.test(paragraph.text));
  let last = -1;
  for (let index = paragraphs.length - 1; index >= 0; index -= 1) {
    if (label.test(paragraphs[index]!.text)) {
      last = index;
      break;
    }
  }
  if (first < 0 || last < first) throw new Error("Interview Magazine speaker boundary is missing");
  const boundary = paragraphs.slice(first, last + 1);
  if (boundary.length !== 118 || boundary.some((paragraph) => !label.test(paragraph.text))) {
    throw new Error("Interview Magazine speaker boundary changed");
  }
  return boundary.map((paragraph) => paragraph.text);
}

function extractVanityFairQuestionnaire($: ReturnType<typeof load>): readonly string[] {
  const containers = $("[data-testid='BodyWrapper'] .body__inner-container");
  if (containers.length !== 1) throw new Error("Expected one Vanity Fair questionnaire body");
  const paragraphs = containers.children("p").toArray().filter(
    (paragraph) => normalizeWhitespace($(paragraph).text()).length > 0,
  );
  if (paragraphs.length !== 50 || paragraphs.length % 2 !== 0) {
    throw new Error("Vanity Fair questionnaire paragraph count changed");
  }
  return paragraphs.map((paragraph, index) => {
    const text = normalizeWhitespace($(paragraph).text());
    const strong = $(paragraph).children("strong");
    if (index % 2 === 0) {
      if (strong.length !== 1 || normalizeWhitespace(strong.text()) !== text) {
        throw new Error("Vanity Fair questionnaire prompt structure changed");
      }
    } else if ($(paragraph).find("strong").length > 0) {
      throw new Error("Vanity Fair questionnaire answer structure changed");
    }
    return text;
  });
}

function directParagraphText(
  $: ReturnType<typeof load>,
  containerSelector: string,
  minimumParagraphs: number,
  directOnly = true,
): readonly string[] {
  const containers = $(containerSelector);
  if (containers.length !== 1) throw new Error(`Expected one ${containerSelector} container`);
  const paragraphs = directOnly ? containers.children("p") : containers.find("p");
  if (paragraphs.length < minimumParagraphs) {
    throw new Error(`${containerSelector} transcript has too few paragraphs`);
  }
  return paragraphs.toArray().map((paragraph) => {
    const clone = $(paragraph).clone();
    clone.find("br").replaceWith(" ");
    return normalizeWhitespace(clone.text());
  }).filter(Boolean);
}

function extractCnnTranscript($: ReturnType<typeof load>): readonly string[] {
  const frame = $("#cnnArticleWireFrame");
  if (frame.length !== 1) throw new Error("Expected one CNN transcript frame");
  const candidates = frame.find("p.cnnBodyText").toArray().filter(
    (paragraph) => $(paragraph).children("br").length > 100,
  );
  if (candidates.length !== 1) throw new Error("Expected one CNN transcript body");
  const clone = $(candidates[0]).clone();
  clone.find("br").replaceWith("\n");
  const segments = clone.text().split("\n").map(normalizeWhitespace).filter(Boolean);
  if (segments.length < 500) throw new Error("CNN transcript has too few line segments");
  return segments;
}

function extractTedTranscript(html: string): readonly string[] {
  const match = /<script\b[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i.exec(html);
  if (!match) throw new Error("Missing TED transcript data");
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1] ?? "");
  } catch {
    throw new Error("Invalid TED transcript data");
  }
  const page = readPath(parsed, ["props", "pageProps", "page"]);
  if (!isRecord(page) || page.uid !== "dolly-parton-is-burning-up-not-burning-out-transcript") {
    throw new Error("TED transcript page identity changed");
  }
  const slices = readPath(page, ["data", "slices"]);
  if (!Array.isArray(slices)) throw new Error("Missing TED transcript slices");
  const candidates = slices.flatMap((slice) => {
    if (!isRecord(slice)) return [];
    const text = readPath(slice, ["primary", "text"]);
    if (!Array.isArray(text) || text.length < 20 || !text.every((entry) =>
      isRecord(entry) && entry.type === "paragraph" && typeof entry.text === "string")) return [];
    return [text];
  });
  if (candidates.length !== 1) throw new Error("Expected one TED transcript body slice");
  const transcript = candidates[0];
  if (!transcript) throw new Error("Missing TED transcript body slice");
  return transcript.map((entry) => {
    if (!isRecord(entry) || typeof entry.text !== "string") {
      throw new Error("Invalid TED transcript segment");
    }
    return normalizeWhitespace(entry.text);
  }).filter(Boolean);
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
  return normalizeWhitespace(decodeHtmlEntities(markup
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")));
}

function normalizeWhitespace(value: string): string {
  return value.normalize("NFC").replace(/\s+/g, " ").trim();
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

function fingerprintSegments(segments: readonly string[]): string {
  const hash = createHash("sha256");
  for (const segment of segments) {
    const bytes = Buffer.from(segment, "utf8");
    const length = Buffer.alloc(8);
    length.writeBigUInt64BE(BigInt(bytes.length));
    hash.update(length);
    hash.update(bytes);
  }
  return `sha256:${hash.digest("hex")}`;
}

function digest(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function readPath(value: unknown, path: readonly (string | number)[]): unknown {
  let current = value;
  for (const key of path) {
    if (typeof key === "number") {
      if (!Array.isArray(current)) return undefined;
      current = current[key];
    } else {
      if (!isRecord(current)) return undefined;
      current = current[key];
    }
  }
  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
