import { describe, expect, it } from "vitest";

import {
  fingerprintNormalizedTranscript,
  fingerprintPersonalitySourceContent,
} from "../src/personality/personality-source-content-fingerprint.js";
import {
  fetchAllowedContentBoundary,
  fetchAllowedHtmlBoundary,
  resolveRequiredLiveSources,
} from "../scripts/validate-personality-source-content-fingerprints.js";
import type { PersonalitySourceEvent } from
  "../src/personality/personality-source-register.js";

describe("personality source content fingerprints", () => {
  it("ignores dynamic wrapper markup around Blank on Blank transcript paragraphs", () => {
    const first = '<main data-request="one"><div class="transcript"><p>First &amp; clear.</p>' +
      '<div><p>Second&nbsp;turn.</p></div><p><img src="dynamic-one"></p></div></main>';
    const second = '<main data-request="two"><div class="transcript"><p>First &amp; clear.</p>' +
      '<div class="changed"><p>Second&nbsp;turn.</p></div><p><img src="dynamic-two"></p></div></main>';
    expect(fingerprintNormalizedTranscript(
      "blank-on-blank-transcript-paragraphs-v1", first,
    ).fingerprint).toBe(fingerprintNormalizedTranscript(
      "blank-on-blank-transcript-paragraphs-v1", second,
    ).fingerprint);
  });

  it("ignores page-shell changes around Fresh Air and NPR article boundaries", () => {
    const freshParagraphs = Array.from({ length: 200 }, (_, index) => `<p>Turn ${index}</p>`).join("");
    const freshFirst = `<header>request one</header><div class="type-segment__transcript__inner">${freshParagraphs}</div>`;
    const freshSecond = `<header>request two</header><div class="type-segment__transcript__inner">${freshParagraphs}</div>`;
    expect(fingerprintNormalizedTranscript(
      "fresh-air-transcript-paragraphs-v1", freshFirst,
    )).toEqual(fingerprintNormalizedTranscript(
      "fresh-air-transcript-paragraphs-v1", freshSecond,
    ));

    const articleParagraphs = Array.from({ length: 10 }, (_, index) => `<p>Block ${index}</p>`).join("");
    const articleFirst = `<aside>dynamic one</aside><div class="ArtP-articleBody">${articleParagraphs}<figure>one</figure></div>`;
    const articleSecond = `<aside>dynamic two</aside><div class="ArtP-articleBody">${articleParagraphs}<figure>two</figure></div>`;
    expect(fingerprintNormalizedTranscript(
      "npr-station-article-body-paragraphs-v1", articleFirst,
    )).toEqual(fingerprintNormalizedTranscript(
      "npr-station-article-body-paragraphs-v1", articleSecond,
    ));
  });

  it("extracts the single large CNN line-delimited transcript body", () => {
    const transcript = Array.from({ length: 501 }, (_, index) => `Turn ${index}<br>`).join("");
    const html = `<div id="cnnArticleWireFrame"><p class="cnnBodyText">metadata</p>` +
      `<p class="cnnBodyText">${transcript}</p></div>`;
    expect(fingerprintNormalizedTranscript(
      "cnn-transcript-body-paragraphs-v1", html,
    ).segmentCount).toBe(501);
  });

  it("selects the identity-bound TED transcript slice from structured data", () => {
    const paragraphs = Array.from({ length: 20 }, (_, index) => ({
      type: "paragraph", text: `Turn ${index}`,
    }));
    const nextData = JSON.stringify({ props: { pageProps: { page: {
      uid: "dolly-parton-is-burning-up-not-burning-out-transcript",
      data: { slices: [{ primary: {} }, { primary: { text: paragraphs } }] },
    } } } });
    const first = `<main>dynamic one</main><script id="__NEXT_DATA__" type="application/json">${nextData}</script>`;
    const second = `<main>dynamic two</main><script id="__NEXT_DATA__" type="application/json">${nextData}</script>`;
    expect(fingerprintNormalizedTranscript(
      "ted-next-data-transcript-segments-v1", first,
    )).toEqual(fingerprintNormalizedTranscript(
      "ted-next-data-transcript-segments-v1", second,
    ));
  });

  it("orders WIRED transcript captions by their explicit index", () => {
    const ordered = '<p data-testid="transcript-caption-0">First.</p>' +
      '<p data-testid="transcript-caption-1">Second.</p>';
    const reversed = '<p data-testid="transcript-caption-1">Second.</p>' +
      '<p data-testid="transcript-caption-0">First.</p>';
    expect(fingerprintNormalizedTranscript(
      "wired-indexed-transcript-captions-v1", ordered,
    )).toEqual(fingerprintNormalizedTranscript(
      "wired-indexed-transcript-captions-v1", reversed,
    ));
  });

  it("changes exact-byte PDF and official-caption fingerprints when bytes change", () => {
    const pdf = fingerprintPersonalitySourceContent("raw-pdf-bytes-v1", Buffer.from("%PDF-one"));
    const changedPdf = fingerprintPersonalitySourceContent("raw-pdf-bytes-v1", Buffer.from("%PDF-two"));
    const caption = fingerprintPersonalitySourceContent("raw-vtt-bytes-v1", Buffer.from("WEBVTT\n"));
    expect(pdf.fingerprint).not.toBe(changedPdf.fingerprint);
    expect(caption).toMatchObject({ segmentCount: null, byteCount: 7 });
  });

  it("changes when normalized transcript content changes", () => {
    const before = '<p data-testid="transcript-caption-0">First.</p>';
    const after = '<p data-testid="transcript-caption-0">Changed.</p>';
    expect(fingerprintNormalizedTranscript(
      "wired-indexed-transcript-captions-v1", before,
    ).fingerprint).not.toBe(fingerprintNormalizedTranscript(
      "wired-indexed-transcript-captions-v1", after,
    ).fingerprint);
  });

  it("rejects noncontiguous WIRED transcript captions", () => {
    expect(() => fingerprintNormalizedTranscript(
      "wired-indexed-transcript-captions-v1",
      '<p data-testid="transcript-caption-1">Second.</p>',
    )).toThrow("missing, duplicated, or empty");
  });

  it("fails when a required live-verification source is missing or downgraded", () => {
    const normalized = sourceFixture("S16", "blank-on-blank-transcript-paragraphs-v1");
    expect(() => resolveRequiredLiveSources([normalized], ["S16", "S17"]))
      .toThrow("S17 is missing");
    expect(() => resolveRequiredLiveSources([
      normalized,
      sourceFixture("S17", "raw-content-boundary-bytes-v1"),
    ], ["S16", "S17"])).toThrow("S17 has an unsupported method");
    expect(() => resolveRequiredLiveSources([
      { ...normalized, accessState: "metadata-only" },
    ], ["S16"])).toThrow("not coding-ready");
  });

  it("rejects disallowed initial and cross-origin redirect destinations", async () => {
    let calls = 0;
    const fetcher = (async () => {
      calls += 1;
      return new Response(null, {
        status: 302,
        headers: { location: "https://other.publisher.example/transcript" },
      });
    }) as typeof fetch;
    await expect(fetchAllowedHtmlBoundary("http://127.0.0.1/transcript", networkPolicy, fetcher))
      .rejects.toThrow("not allowed");
    expect(calls).toBe(0);
    await expect(fetchAllowedHtmlBoundary(
      "https://secret@publisher.example/transcript", networkPolicy, fetcher,
    )).rejects.toThrow("not allowed");
    expect(calls).toBe(0);
    await expect(fetchAllowedHtmlBoundary(
      "https://publisher.example/transcript", networkPolicy, fetcher,
    )).rejects.toThrow("Cross-origin");
    expect(calls).toBe(1);
  });

  it("follows bounded same-origin redirects and reports their count", async () => {
    let calls = 0;
    const fetcher = (async (input) => {
      calls += 1;
      const url = input.toString();
      if (url.endsWith("/old")) return new Response(null, {
        status: 302,
        headers: { location: "/current" },
      });
      return new Response("%PDF-current", {
        status: 200,
        headers: { "content-type": "application/pdf" },
      });
    }) as typeof fetch;
    const result = await fetchAllowedContentBoundary(
      "https://publisher.example/old", "raw-pdf-bytes-v1", networkPolicy, fetcher,
    );
    expect(result.redirectCount).toBe(1);
    expect(calls).toBe(2);
  });

  it("rejects blocked responses, wrong media types, content encodings, and oversized bodies", async () => {
    const blocked = (async () => new Response("blocked", { status: 403 })) as typeof fetch;
    await expect(fetchAllowedContentBoundary(
      "https://publisher.example/file", "raw-pdf-bytes-v1", networkPolicy, blocked,
    )).rejects.toThrow("returned 403");

    const wrongType = (async () => new Response("not a pdf", {
      status: 200, headers: { "content-type": "text/html" },
    })) as typeof fetch;
    await expect(fetchAllowedContentBoundary(
      "https://publisher.example/file", "raw-pdf-bytes-v1", networkPolicy, wrongType,
    )).rejects.toThrow("unsupported media type");

    const encoded = (async () => new Response("compressed", {
      status: 200,
      headers: { "content-type": "application/pdf", "content-encoding": "gzip" },
    })) as typeof fetch;
    await expect(fetchAllowedContentBoundary(
      "https://publisher.example/file", "raw-pdf-bytes-v1", networkPolicy, encoded,
    )).rejects.toThrow("unsupported encoding");

    const oversized = (async () => new Response("123456789", {
      status: 200,
      headers: { "content-length": "9", "content-type": "text/html" },
    })) as typeof fetch;
    await expect(fetchAllowedHtmlBoundary(
      "https://publisher.example/transcript",
      { ...networkPolicy, maximumResponseBytes: 8 },
      oversized,
    )).rejects.toThrow("response-size limit");
  });
});

const networkPolicy = {
  allowedOrigins: ["https://publisher.example", "https://other.publisher.example"],
  timeoutMs: 1_000,
  maximumResponseBytes: 1_024,
  maximumRedirects: 1,
} as const;

function sourceFixture(
  sourceRegisterId: string,
  fingerprintMethod: PersonalitySourceEvent["fingerprintMethod"],
): PersonalitySourceEvent {
  return { sourceRegisterId, fingerprintMethod, accessState: "coding-ready" } as PersonalitySourceEvent;
}
