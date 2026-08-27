import { describe, expect, it } from "vitest";

import {
  parsePublicDeploymentPreflightConfig,
  verifyPublicDeployment,
} from "../src/public/public-deployment-preflight.js";

const corpusVersion = `career:${"a".repeat(64)}`;
const apiToken = "public-preflight-token-at-least-32-characters";
const securityHeaders = {
  "cache-control": "no-store",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "content-type": "application/json; charset=utf-8",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};

describe("public deployment preflight", () => {
  it("accepts only a public HTTPS root origin unless loopback is explicit", () => {
    expect(parsePublicDeploymentPreflightConfig(environment())).toMatchObject({
      origin: "https://jolene.example.com",
      apiToken,
      expectedCorpusVersion: corpusVersion,
      allowLoopback: false,
      timeoutMilliseconds: 8_000,
    });

    for (const origin of [
      "http://jolene.example.com",
      "https://127.0.0.1",
      "https://100.64.0.1",
      "https://[fd00::1]",
      "https://jolene.example.com/path",
      "https://user:pass@jolene.example.com",
    ]) {
      expect(() => parsePublicDeploymentPreflightConfig(environment({
        JOLENE_PUBLIC_DEPLOYMENT_ORIGIN: origin,
      }))).toThrow();
    }
    expect(() => parsePublicDeploymentPreflightConfig(environment({
      JOLENE_PUBLIC_API_TOKEN: "too-short",
    }))).toThrow();

    expect(parsePublicDeploymentPreflightConfig(environment({
      JOLENE_PUBLIC_DEPLOYMENT_ORIGIN: "http://127.0.0.1:8431",
      JOLENE_PUBLIC_DEPLOYMENT_ALLOW_LOOPBACK: "true",
    })).origin).toBe("http://127.0.0.1:8431");
    expect(parsePublicDeploymentPreflightConfig(environment({
      JOLENE_PUBLIC_DEPLOYMENT_ORIGIN: "http://[::1]:8431",
      JOLENE_PUBLIC_DEPLOYMENT_ALLOW_LOOPBACK: "true",
    })).origin).toBe("http://[::1]:8431");
  });

  it("verifies health, credential rejection, the approved corpus, and headers", async () => {
    const authorization: Array<string | null> = [];
    const fetchImpl = async (_input: URL | RequestInfo, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      authorization.push(headers.get("authorization"));
      const index = authorization.length - 1;
      if (index === 0) return jsonResponse(200, health());
      if (index === 1 || index === 2) return unauthorizedResponse();
      return jsonResponse(200, manifest());
    };

    const report = await verifyPublicDeployment(
      parsePublicDeploymentPreflightConfig(environment()),
      {
        fetchImpl: fetchImpl as typeof fetch,
        now: () => new Date("2026-08-27T16:00:00.000Z"),
      },
    );

    expect(authorization).toEqual([
      null,
      null,
      "Bearer jolene-preflight-invalid-token-000000",
      `Bearer ${apiToken}`,
    ]);
    expect(report).toEqual({
      schemaVersion: "jolene.public-deployment-preflight.v1",
      checkedAt: "2026-08-27T16:00:00.000Z",
      origin: "https://jolene.example.com",
      corpusVersion,
      corpusHash: `sha256:${"a".repeat(64)}`,
      evidenceCount: 41,
      revocationCount: 0,
      checks: {
        health: "passed",
        missingCredential: "rejected",
        invalidCredential: "rejected",
        authorizedManifest: "passed",
        browserCors: "not_enabled",
        securityHeaders: "passed",
      },
    });
    expect(JSON.stringify(report)).not.toContain(apiToken);
  });

  it("fails when the service accepts a missing credential", async () => {
    const responses = [
      jsonResponse(200, health()),
      jsonResponse(200, manifest()),
    ];
    await expect(verifyPublicDeployment(config(), {
      fetchImpl: sequence(responses),
    })).rejects.toMatchObject({
      code: "missing_credential_accepted",
    });
  });

  it("fails on permissive browser CORS or corpus drift", async () => {
    const corsHealth = jsonResponse(200, health(), {
      "access-control-allow-origin": "*",
    });
    await expect(verifyPublicDeployment(config(), {
      fetchImpl: sequence([corsHealth]),
    })).rejects.toMatchObject({
      code: "security_headers_invalid",
    });

    await expect(verifyPublicDeployment(config(), {
      fetchImpl: sequence([
        jsonResponse(200, health()),
        unauthorizedResponse(),
        unauthorizedResponse(),
        jsonResponse(200, manifest({
          corpusVersion: `career:${"b".repeat(64)}`,
          corpusHash: `sha256:${"b".repeat(64)}`,
        })),
      ]),
    })).rejects.toMatchObject({
      code: "corpus_version_mismatch",
    });
  });
});

function environment(overrides: Record<string, string> = {}) {
  return {
    JOLENE_PUBLIC_DEPLOYMENT_ORIGIN: "https://jolene.example.com",
    JOLENE_PUBLIC_API_TOKEN: apiToken,
    JOLENE_PUBLIC_EXPECTED_CORPUS_VERSION: corpusVersion,
    ...overrides,
  };
}

function config() {
  return parsePublicDeploymentPreflightConfig(environment());
}

function health() {
  return {
    status: "ok",
    schemaVersion: "1.0.0",
    corpusVersion,
    evidenceCount: 41,
  };
}

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "1.0.0",
    corpusVersion,
    corpusHash: `sha256:${"a".repeat(64)}`,
    generatedAt: "2026-08-27T15:00:00.000Z",
    reviewedAt: "2026-08-27T14:00:00.000Z",
    evidenceCount: 41,
    revokedEvidenceIds: [],
    ...overrides,
  };
}

function unauthorizedResponse() {
  return jsonResponse(401, {
    schemaVersion: "1.0.0",
    code: "request_rejected",
    message: "The requested operation is not available.",
    requestId: `req:${"0".repeat(32)}`,
  }, { "www-authenticate": "Bearer" });
}

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...securityHeaders, ...headers },
  });
}

function sequence(responses: Response[]): typeof fetch {
  return (async () => {
    const response = responses.shift();
    if (!response) throw new Error("Unexpected request");
    return response;
  }) as typeof fetch;
}
