import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { fingerprintPersonalitySourceContent } from
  "../src/personality/personality-source-content-fingerprint.js";
import type { PersonalitySourceFingerprintMethod } from
  "../src/personality/personality-source-content-fingerprint.js";
import {
  fetchAllowedContentBoundary,
  type ContentBoundaryNetworkPolicy,
  type RetrievedContentBoundary,
} from "../src/personality/personality-source-content-boundary.js";
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

type LiveFingerprintNetworkPolicy = ContentBoundaryNetworkPolicy;

export {
  fetchAllowedContentBoundary,
  fetchAllowedHtmlBoundary,
  type RetrievedContentBoundary,
} from "../src/personality/personality-source-content-boundary.js";

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await validatePersonalitySourceFingerprints();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
