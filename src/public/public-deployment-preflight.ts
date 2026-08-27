import { isIP } from "node:net";

import { z } from "zod";

import {
  PUBLIC_CAREER_EVIDENCE_SCHEMA_VERSION,
  publicCareerEvidenceManifestSchema,
} from "../domain/public-career-evidence.js";
import { publicJoleneErrorResponseSchema } from
  "../domain/public-portfolio-contract.js";

const REPORT_SCHEMA_VERSION = "jolene.public-deployment-preflight.v1" as const;
const MAXIMUM_RESPONSE_BYTES = 64_000;

const environmentSchema = z.object({
  JOLENE_PUBLIC_DEPLOYMENT_ORIGIN: z.string().trim().min(1),
  JOLENE_PUBLIC_API_TOKEN: z.string().trim().min(32),
  JOLENE_PUBLIC_EXPECTED_CORPUS_VERSION: z.string()
    .regex(/^career:[a-f0-9]{64}$/),
  JOLENE_PUBLIC_DEPLOYMENT_ALLOW_LOOPBACK: z.enum(["true", "false"])
    .default("false"),
  JOLENE_PUBLIC_DEPLOYMENT_TIMEOUT_MS: z.coerce.number().int().min(1_000)
    .max(30_000).default(8_000),
});

const publicHealthSchema = z.object({
  status: z.literal("ok"),
  schemaVersion: z.literal(PUBLIC_CAREER_EVIDENCE_SCHEMA_VERSION),
  corpusVersion: z.string().regex(/^career:[a-f0-9]{64}$/),
  evidenceCount: z.number().int().nonnegative(),
}).strict();

export interface PublicDeploymentPreflightConfig {
  readonly origin: string;
  readonly apiToken: string;
  readonly expectedCorpusVersion: string;
  readonly allowLoopback: boolean;
  readonly timeoutMilliseconds: number;
}

export interface PublicDeploymentPreflightReport {
  readonly schemaVersion: typeof REPORT_SCHEMA_VERSION;
  readonly checkedAt: string;
  readonly origin: string;
  readonly corpusVersion: string;
  readonly corpusHash: string;
  readonly evidenceCount: number;
  readonly revocationCount: number;
  readonly checks: {
    readonly health: "passed";
    readonly missingCredential: "rejected";
    readonly invalidCredential: "rejected";
    readonly authorizedManifest: "passed";
    readonly browserCors: "not_enabled";
    readonly securityHeaders: "passed";
  };
}

export class PublicDeploymentPreflightError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "PublicDeploymentPreflightError";
  }
}

export function parsePublicDeploymentPreflightConfig(
  environment: Record<string, string | undefined>,
): PublicDeploymentPreflightConfig {
  const parsed = environmentSchema.parse(environment);
  const allowLoopback = parsed.JOLENE_PUBLIC_DEPLOYMENT_ALLOW_LOOPBACK === "true";
  const origin = normalizeOrigin(parsed.JOLENE_PUBLIC_DEPLOYMENT_ORIGIN, allowLoopback);
  return {
    origin,
    apiToken: parsed.JOLENE_PUBLIC_API_TOKEN,
    expectedCorpusVersion: parsed.JOLENE_PUBLIC_EXPECTED_CORPUS_VERSION,
    allowLoopback,
    timeoutMilliseconds: parsed.JOLENE_PUBLIC_DEPLOYMENT_TIMEOUT_MS,
  };
}

export async function verifyPublicDeployment(
  config: PublicDeploymentPreflightConfig,
  dependencies: {
    readonly fetchImpl?: typeof fetch;
    readonly now?: () => Date;
  } = {},
): Promise<PublicDeploymentPreflightReport> {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const healthResponse = await request(
    new URL("/health", config.origin),
    undefined,
    config,
    fetchImpl,
  );
  requireStatus(healthResponse, 200, "health_unavailable");
  assertPublicResponseHeaders(healthResponse);
  const health = publicHealthSchema.parse(await readBoundedJson(healthResponse));

  const manifestUrl = new URL("/v1/public-evidence/manifest", config.origin);
  const missingCredential = await request(manifestUrl, undefined, config, fetchImpl);
  await assertCredentialRejected(missingCredential, "missing_credential_accepted");

  const invalidCredential = await request(
    manifestUrl,
    invalidCredentialFor(config.apiToken),
    config,
    fetchImpl,
  );
  await assertCredentialRejected(invalidCredential, "invalid_credential_accepted");

  const manifestResponse = await request(
    manifestUrl,
    config.apiToken,
    config,
    fetchImpl,
  );
  requireStatus(manifestResponse, 200, "authorized_manifest_unavailable");
  assertPublicResponseHeaders(manifestResponse);
  const manifest = publicCareerEvidenceManifestSchema.parse(
    await readBoundedJson(manifestResponse),
  );

  if (
    manifest.corpusVersion !== config.expectedCorpusVersion ||
    health.corpusVersion !== manifest.corpusVersion ||
    health.evidenceCount !== manifest.evidenceCount
  ) {
    throw new PublicDeploymentPreflightError("corpus_version_mismatch");
  }

  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    checkedAt: (dependencies.now?.() ?? new Date()).toISOString(),
    origin: config.origin,
    corpusVersion: manifest.corpusVersion,
    corpusHash: manifest.corpusHash,
    evidenceCount: manifest.evidenceCount,
    revocationCount: manifest.revokedEvidenceIds.length,
    checks: {
      health: "passed",
      missingCredential: "rejected",
      invalidCredential: "rejected",
      authorizedManifest: "passed",
      browserCors: "not_enabled",
      securityHeaders: "passed",
    },
  };
}

function normalizeOrigin(value: string, allowLoopback: boolean): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PublicDeploymentPreflightError("invalid_origin");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const loopback = (hostname === "127.0.0.1" || hostname === "::1") &&
    url.protocol === "http:" && allowLoopback;
  if (
    (!loopback && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    (!loopback && isPrivateHostname(hostname))
  ) {
    throw new PublicDeploymentPreflightError("unsafe_origin");
  }
  return url.origin;
}

function invalidCredentialFor(expectedToken: string): string {
  const first = "jolene-preflight-invalid-token-000000";
  return first === expectedToken
    ? "jolene-preflight-invalid-token-111111"
    : first;
}

function isPrivateHostname(hostname: string): boolean {
  const value = hostname.toLowerCase();
  if (value === "localhost" || value.endsWith(".local")) return true;
  if (isIP(value) === 6) return true;
  if (isIP(value) !== 4) return false;
  const octets = value.split(".").map(Number);
  const first = octets[0] ?? -1;
  const second = octets[1] ?? -1;
  return first === 0 || first === 10 || first === 127 || first >= 224 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19));
}

async function request(
  url: URL,
  token: string | undefined,
  config: PublicDeploymentPreflightConfig,
  fetchImpl: typeof fetch,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMilliseconds);
  try {
    return await fetchImpl(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
  } catch {
    throw new PublicDeploymentPreflightError("request_failed");
  } finally {
    clearTimeout(timeout);
  }
}

async function assertCredentialRejected(
  response: Response,
  failureCode: string,
): Promise<void> {
  if (response.status !== 401) throw new PublicDeploymentPreflightError(failureCode);
  assertPublicResponseHeaders(response);
  if (response.headers.get("www-authenticate") !== "Bearer") {
    throw new PublicDeploymentPreflightError("authentication_challenge_missing");
  }
  const error = publicJoleneErrorResponseSchema.parse(await readBoundedJson(response));
  if (error.code !== "request_rejected") {
    throw new PublicDeploymentPreflightError("unsafe_authentication_error");
  }
}

function requireStatus(response: Response, expected: number, code: string): void {
  if (response.status !== expected) throw new PublicDeploymentPreflightError(code);
}

function assertPublicResponseHeaders(response: Response): void {
  if (
    !response.headers.get("cache-control")?.split(",").map((value) => value.trim())
      .includes("no-store") ||
    response.headers.get("x-content-type-options") !== "nosniff" ||
    response.headers.get("referrer-policy") !== "no-referrer" ||
    !response.headers.get("content-security-policy")?.includes("default-src 'none'") ||
    response.headers.has("access-control-allow-origin")
  ) {
    throw new PublicDeploymentPreflightError("security_headers_invalid");
  }
}

async function readBoundedJson(response: Response): Promise<unknown> {
  if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new PublicDeploymentPreflightError("response_content_type_invalid");
  }
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength !== null &&
    (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAXIMUM_RESPONSE_BYTES)
  ) {
    throw new PublicDeploymentPreflightError("response_too_large");
  }
  const text = await response.text();
  if (Buffer.byteLength(text) > MAXIMUM_RESPONSE_BYTES) {
    throw new PublicDeploymentPreflightError("response_too_large");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new PublicDeploymentPreflightError("response_json_invalid");
  }
}
