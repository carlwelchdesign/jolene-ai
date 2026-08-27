import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { fingerprintNormalizedTranscript } from
  "../src/personality/personality-source-content-fingerprint.js";
import type { NormalizedTranscriptFingerprintMethod } from
  "../src/personality/personality-source-content-fingerprint.js";
import { loadPersonalitySourceRegisterV2 } from
  "../src/personality/personality-source-register.js";
import type { PersonalitySourceEvent } from
  "../src/personality/personality-source-register.js";

const supportedMethods = new Set<NormalizedTranscriptFingerprintMethod>([
  "blank-on-blank-transcript-paragraphs-v1",
  "wired-indexed-transcript-captions-v1",
]);

export async function validateNormalizedPersonalitySourceFingerprints(
  projectRoot = process.cwd(),
  fetcher: typeof fetch = fetch,
) {
  const register = await loadPersonalitySourceRegisterV2(projectRoot);
  const sources = resolveRequiredNormalizedSources(
    register.events,
    register.liveFingerprintPolicy.requiredSourceIds,
  );
  const results = [];
  for (const source of sources) {
    if (!source.contentBoundaryUrl || !source.sourceContentFingerprint) {
      throw new Error(`${source.sourceRegisterId} lacks a fingerprinted content boundary`);
    }
    const html = await fetchAllowedHtmlBoundary(
      source.contentBoundaryUrl,
      register.liveFingerprintPolicy,
      fetcher,
    );
    const computed = fingerprintNormalizedTranscript(
      source.fingerprintMethod as NormalizedTranscriptFingerprintMethod,
      html,
    );
    if (computed.fingerprint !== source.sourceContentFingerprint) {
      throw new Error(`${source.sourceRegisterId} normalized transcript fingerprint changed`);
    }
    results.push({
      sourceRegisterId: source.sourceRegisterId,
      fingerprintMethod: source.fingerprintMethod,
      segmentCount: computed.segmentCount,
      fingerprint: computed.fingerprint,
      status: "verified" as const,
    });
  }
  return { verifiedSources: results.length, sources: results };
}

export function resolveRequiredNormalizedSources(
  events: readonly PersonalitySourceEvent[],
  requiredSourceIds: readonly string[],
): readonly PersonalitySourceEvent[] {
  const byId = new Map(events.map((source) => [source.sourceRegisterId, source]));
  return requiredSourceIds.map((id) => {
    const source = byId.get(id);
    if (!source) throw new Error(`Required live fingerprint source ${id} is missing`);
    if (!supportedMethods.has(
      source.fingerprintMethod as NormalizedTranscriptFingerprintMethod,
    )) {
      throw new Error(`Required live fingerprint source ${id} has an unsupported method`);
    }
    return source;
  });
}

interface LiveFingerprintNetworkPolicy {
  readonly allowedOrigins: readonly string[];
  readonly timeoutMs: number;
  readonly maximumResponseBytes: number;
  readonly maximumRedirects: number;
}

export async function fetchAllowedHtmlBoundary(
  initialUrl: string,
  policy: LiveFingerprintNetworkPolicy,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  let current = assertAllowedUrl(initialUrl, policy.allowedOrigins);
  const signal = AbortSignal.timeout(policy.timeoutMs);
  for (let redirectCount = 0; ; redirectCount += 1) {
    const response = await fetcher(current, { redirect: "manual", signal });
    const responseUrl = response.url || current.toString();
    const finalUrl = assertAllowedUrl(responseUrl, policy.allowedOrigins);
    if (finalUrl.origin !== current.origin) throw new Error("Cross-origin content redirect denied");
    if (response.status >= 300 && response.status < 400) {
      if (redirectCount >= policy.maximumRedirects) throw new Error("Too many content redirects");
      const location = response.headers.get("location");
      if (!location) throw new Error("Content redirect lacks a location header");
      const next = assertAllowedUrl(new URL(location, current).toString(), policy.allowedOrigins);
      if (next.origin !== current.origin) throw new Error("Cross-origin content redirect denied");
      current = next;
      continue;
    }
    if (!response.ok) throw new Error(`Content boundary returned ${response.status}`);
    if (!response.headers.get("content-type")?.toLowerCase().includes("text/html")) {
      throw new Error("Content boundary did not return HTML");
    }
    return readBoundedText(response, policy.maximumResponseBytes);
  }
}

function assertAllowedUrl(value: string, allowedOrigins: readonly string[]): URL {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || !allowedOrigins.includes(parsed.origin)) {
    throw new Error(`Content boundary origin is not allowed: ${parsed.origin}`);
  }
  return parsed;
}

async function readBoundedText(response: Response, maximumBytes: number): Promise<string> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && Number.parseInt(declaredLength, 10) > maximumBytes) {
    throw new Error("Content boundary exceeds the response-size limit");
  }
  if (!response.body) throw new Error("Content boundary has no response body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel("response-size-limit");
      throw new Error("Content boundary exceeds the response-size limit");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await validateNormalizedPersonalitySourceFingerprints();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
