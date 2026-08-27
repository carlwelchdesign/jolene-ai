import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { fingerprintPersonalitySourceContent } from
  "../src/personality/personality-source-content-fingerprint.js";
import type { PersonalitySourceFingerprintMethod } from
  "../src/personality/personality-source-content-fingerprint.js";
import { loadPersonalitySourceRegisterV2 } from
  "../src/personality/personality-source-register.js";
import { loadPersonalitySourceRegisterV3 } from
  "../src/personality/personality-source-register-v3.js";
import type { PersonalitySourceEvent } from
  "../src/personality/personality-source-register.js";

const supportedMethods = new Set<PersonalitySourceFingerprintMethod>([
  "raw-pdf-bytes-v1",
  "raw-vtt-bytes-v1",
  "fresh-air-transcript-paragraphs-v1",
  "cnn-transcript-body-paragraphs-v1",
  "npr-station-article-body-paragraphs-v1",
  "ted-next-data-transcript-segments-v1",
  "blank-on-blank-transcript-paragraphs-v1",
  "interview-magazine-speaker-paragraphs-v1",
  "vanity-fair-proust-pairs-v1",
  "wired-indexed-transcript-captions-v1",
]);

export async function validatePersonalitySourceFingerprints(
  projectRoot = process.cwd(),
  fetcher: typeof fetch = fetch,
) {
  const register = await loadPersonalitySourceRegisterV2(projectRoot);
  return validateRegisterFingerprints(register, fetcher);
}

export async function validatePersonalitySourceFingerprintsV3(
  projectRoot = process.cwd(),
  fetcher: typeof fetch = fetch,
) {
  const register = await loadPersonalitySourceRegisterV3(projectRoot);
  return validateRegisterFingerprints(register, fetcher);
}

async function validateRegisterFingerprints(
  register: {
    readonly events: readonly PersonalitySourceEvent[];
    readonly liveFingerprintPolicy: LiveFingerprintNetworkPolicy & {
      readonly requiredSourceIds: readonly string[];
    };
  },
  fetcher: typeof fetch,
) {
  const sources = resolveRequiredLiveSources(
    register.events,
    register.liveFingerprintPolicy.requiredSourceIds,
  );
  const results = [];
  for (const source of sources) {
    if (!source.contentBoundaryUrl || !source.sourceContentFingerprint) {
      throw new Error(`${source.sourceRegisterId} lacks a fingerprinted content boundary`);
    }
    const method = source.fingerprintMethod as PersonalitySourceFingerprintMethod;
    let retrieved: RetrievedContentBoundary;
    let computed: ReturnType<typeof fingerprintPersonalitySourceContent>;
    try {
      retrieved = await fetchAllowedContentBoundary(
        source.contentBoundaryUrl,
        method,
        register.liveFingerprintPolicy,
        fetcher,
      );
      computed = fingerprintPersonalitySourceContent(method, retrieved.bytes);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown verification failure";
      throw new Error(`${source.sourceRegisterId} live verification failed: ${detail}`, {
        cause: error,
      });
    }
    if (computed.fingerprint !== source.sourceContentFingerprint) {
      throw new Error(`${source.sourceRegisterId} source content is stale: fingerprint changed`);
    }
    results.push({
      sourceRegisterId: source.sourceRegisterId,
      fingerprintMethod: source.fingerprintMethod,
      mediaType: retrieved.mediaType,
      byteCount: computed.byteCount,
      segmentCount: computed.segmentCount,
      redirectCount: retrieved.redirectCount,
      fingerprint: computed.fingerprint,
      status: "verified" as const,
    });
  }
  return { verifiedSources: results.length, sources: results };
}

export const validateNormalizedPersonalitySourceFingerprints =
  validatePersonalitySourceFingerprints;

export function resolveRequiredLiveSources(
  events: readonly PersonalitySourceEvent[],
  requiredSourceIds: readonly string[],
): readonly PersonalitySourceEvent[] {
  const byId = new Map(events.map((source) => [source.sourceRegisterId, source]));
  return requiredSourceIds.map((id) => {
    const source = byId.get(id);
    if (!source) throw new Error(`Required live fingerprint source ${id} is missing`);
    if (source.accessState !== "coding-ready") {
      throw new Error(`Required live fingerprint source ${id} is not coding-ready`);
    }
    if (!supportedMethods.has(source.fingerprintMethod as PersonalitySourceFingerprintMethod)) {
      throw new Error(`Required live fingerprint source ${id} has an unsupported method`);
    }
    return source;
  });
}

export const resolveRequiredNormalizedSources = resolveRequiredLiveSources;

interface LiveFingerprintNetworkPolicy {
  readonly allowedOrigins: readonly string[];
  readonly timeoutMs: number;
  readonly maximumResponseBytes: number;
  readonly maximumRedirects: number;
}

export interface RetrievedContentBoundary {
  readonly bytes: Uint8Array;
  readonly mediaType: string;
  readonly redirectCount: number;
}

export async function fetchAllowedContentBoundary(
  initialUrl: string,
  method: PersonalitySourceFingerprintMethod,
  policy: LiveFingerprintNetworkPolicy,
  fetcher: typeof fetch = fetch,
): Promise<RetrievedContentBoundary> {
  let current = assertAllowedUrl(initialUrl, policy.allowedOrigins);
  const signal = AbortSignal.timeout(policy.timeoutMs);
  for (let redirectCount = 0; ; redirectCount += 1) {
    const response = await fetcher(current, {
      redirect: "manual",
      signal,
      headers: {
        accept: acceptedMediaTypes(method),
        "accept-encoding": "identity",
        "user-agent": "JoleneSourceDriftVerifier/1.0",
      },
    });
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
    if (response.status !== 200) throw new Error(`Content boundary returned ${response.status}`);
    const contentEncoding = response.headers.get("content-encoding")?.toLowerCase();
    if (contentEncoding && contentEncoding !== "identity") {
      throw new Error(`Content boundary returned unsupported encoding ${contentEncoding}`);
    }
    const mediaType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (!mediaType || !allowedMediaTypes(method).includes(mediaType)) {
      throw new Error(`Content boundary returned unsupported media type ${mediaType ?? "missing"}`);
    }
    return {
      bytes: await readBoundedBytes(response, policy.maximumResponseBytes),
      mediaType,
      redirectCount,
    };
  }
}

export async function fetchAllowedHtmlBoundary(
  initialUrl: string,
  policy: LiveFingerprintNetworkPolicy,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const result = await fetchAllowedContentBoundary(
    initialUrl,
    "blank-on-blank-transcript-paragraphs-v1",
    policy,
    fetcher,
  );
  return new TextDecoder("utf-8", { fatal: true }).decode(result.bytes);
}

function acceptedMediaTypes(method: PersonalitySourceFingerprintMethod): string {
  return allowedMediaTypes(method).join(", ");
}

function allowedMediaTypes(method: PersonalitySourceFingerprintMethod): readonly string[] {
  if (method === "raw-pdf-bytes-v1") return ["application/pdf"];
  if (method === "raw-vtt-bytes-v1") return ["text/vtt"];
  return ["text/html", "application/xhtml+xml"];
}

function assertAllowedUrl(value: string, allowedOrigins: readonly string[]): URL {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password ||
      !allowedOrigins.includes(parsed.origin)) {
    throw new Error(`Content boundary origin is not allowed: ${parsed.origin}`);
  }
  return parsed;
}

async function readBoundedBytes(response: Response, maximumBytes: number): Promise<Uint8Array> {
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
  return bytes;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await validatePersonalitySourceFingerprints();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
