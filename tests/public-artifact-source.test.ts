import { describe, expect, it } from "vitest";

import {
  HttpsPublicArtifactSource,
  PublicArtifactIntegrityError,
  PublicArtifactUnavailableError,
  PublicArtifactVersionMismatchError,
} from "../src/public/public-artifact-source.js";
import { createPublicEvidenceArtifact } from
  "./helpers/public-evidence-fixture.js";

describe("HTTPS public artifact source", () => {
  it("fetches a bounded no-store artifact and verifies its pinned corpus", async () => {
    const artifact = createPublicEvidenceArtifact();
    const requests: Array<{ input: string; init: RequestInit | undefined }> = [];
    const source = new HttpsPublicArtifactSource({
      url: "https://evidence.example.com/public-career-evidence.json",
      expectedCorpusVersion: artifact.manifest.corpusVersion,
      timeoutMilliseconds: 2_000,
      fetchImpl: (async (input: URL | RequestInfo, init?: RequestInit) => {
        requests.push({ input: String(input), init });
        return jsonResponse(200, artifact);
      }) as typeof fetch,
    });

    await expect(source.read()).resolves.toEqual(artifact);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.input).toBe(
      "https://evidence.example.com/public-career-evidence.json",
    );
    expect(requests[0]?.init).toMatchObject({
      method: "GET",
      cache: "no-store",
      redirect: "error",
    });
    expect(new Headers(requests[0]?.init?.headers).get("authorization")).toBeNull();
  });

  it("treats a missing artifact as unavailable without accepting another corpus", async () => {
    const artifact = createPublicEvidenceArtifact();
    const missing = sourceFor(artifact, async () => jsonResponse(404, {
      status: "not_found",
    }));
    await expect(missing.read()).resolves.toBeNull();

    const drifted = sourceFor(artifact, async () => jsonResponse(
      200,
      createPublicEvidenceArtifact([]),
    ));
    await expect(drifted.read()).rejects.toBeInstanceOf(
      PublicArtifactVersionMismatchError,
    );
  });

  it("fails closed for transport, media type, size, JSON, and integrity errors", async () => {
    const artifact = createPublicEvidenceArtifact();
    const scenarios: Array<{
      readonly fetchImpl: typeof fetch;
      readonly error: typeof PublicArtifactIntegrityError | typeof PublicArtifactUnavailableError;
    }> = [
      {
        fetchImpl: (async () => { throw new Error("offline"); }) as typeof fetch,
        error: PublicArtifactUnavailableError,
      },
      {
        fetchImpl: (async () => new Response("{}", {
          status: 503,
          headers: { "content-type": "application/json" },
        })) as typeof fetch,
        error: PublicArtifactUnavailableError,
      },
      {
        fetchImpl: (async () => new Response("not json", {
          status: 200,
          headers: { "content-type": "text/plain" },
        })) as typeof fetch,
        error: PublicArtifactIntegrityError,
      },
      {
        fetchImpl: (async () => jsonResponse(200, artifact, {
          "content-length": "1000001",
        })) as typeof fetch,
        error: PublicArtifactIntegrityError,
      },
      {
        fetchImpl: (async () => new Response("{broken", {
          status: 200,
          headers: { "content-type": "application/json" },
        })) as typeof fetch,
        error: PublicArtifactIntegrityError,
      },
      {
        fetchImpl: (async () => jsonResponse(200, {
          ...artifact,
          manifest: {
            ...artifact.manifest,
            corpusHash: `sha256:${"0".repeat(64)}`,
          },
        })) as typeof fetch,
        error: PublicArtifactIntegrityError,
      },
    ];

    for (const scenario of scenarios) {
      await expect(sourceFor(artifact, scenario.fetchImpl).read())
        .rejects.toBeInstanceOf(scenario.error);
    }
  });
});

function sourceFor(
  expectedArtifact: ReturnType<typeof createPublicEvidenceArtifact>,
  fetchImpl: typeof fetch,
) {
  return new HttpsPublicArtifactSource({
    url: "https://evidence.example.com/public-career-evidence.json",
    expectedCorpusVersion: expectedArtifact.manifest.corpusVersion,
    timeoutMilliseconds: 2_000,
    fetchImpl,
  });
}

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}
