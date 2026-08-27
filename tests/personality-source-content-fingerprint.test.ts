import { describe, expect, it } from "vitest";

import { fingerprintNormalizedTranscript } from
  "../src/personality/personality-source-content-fingerprint.js";
import { fetchAllowedHtmlBoundary, resolveRequiredNormalizedSources } from
  "../scripts/validate-personality-source-content-fingerprints.js";
import type { PersonalitySourceEvent } from
  "../src/personality/personality-source-register.js";

describe("normalized personality source content fingerprints", () => {
  it("ignores dynamic wrapper markup around Blank on Blank transcript paragraphs", () => {
    const first = '<main data-request="one"><div class="transcript"><p>First &amp; clear.</p>' +
      '<div><p>Second&nbsp;turn.</p></div><p><img src="dynamic-one"></p></div></main>';
    const second = '<main data-request="two"><div class="transcript"><p>First &amp; clear.</p>' +
      '<div class="changed"><p>Second&nbsp;turn.</p></div><p><img src="dynamic-two"></p></div></main>';
    expect(fingerprintNormalizedTranscript(
      "blank-on-blank-transcript-paragraphs-v1", first,
    )).toEqual(fingerprintNormalizedTranscript(
      "blank-on-blank-transcript-paragraphs-v1", second,
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
    expect(() => resolveRequiredNormalizedSources([normalized], ["S16", "S17"]))
      .toThrow("S17 is missing");
    expect(() => resolveRequiredNormalizedSources([
      normalized,
      sourceFixture("S17", "raw-content-boundary-bytes-v1"),
    ], ["S16", "S17"])).toThrow("S17 has an unsupported method");
  });

  it("rejects disallowed initial and redirect origins before reading content", async () => {
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
      "https://publisher.example/transcript", networkPolicy, fetcher,
    )).rejects.toThrow("Cross-origin");
    expect(calls).toBe(1);
  });

  it("enforces the bounded response reader", async () => {
    const fetcher = (async () => new Response("123456789", {
      status: 200,
      headers: { "content-length": "9", "content-type": "text/html" },
    })) as typeof fetch;
    await expect(fetchAllowedHtmlBoundary(
      "https://publisher.example/transcript",
      { ...networkPolicy, maximumResponseBytes: 8 },
      fetcher,
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
  return { sourceRegisterId, fingerprintMethod } as PersonalitySourceEvent;
}
