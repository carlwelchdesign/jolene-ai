import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

import {
  PUBLIC_CAREER_EVIDENCE_SCHEMA_VERSION,
  type PublicCareerEvidenceArtifact,
} from "../domain/public-career-evidence.js";
import {
  contactIntentRequestSchema,
  portfolioAnswerRequestSchema,
  portfolioJobFitRequestSchema,
  publicJoleneErrorResponseSchema,
  type PublicJoleneErrorCode,
  type PublicJoleneErrorResponse,
} from "../domain/public-portfolio-contract.js";
import {
  PublicArtifactVersionMismatchError,
  type PublicArtifactSource,
} from "./public-artifact-source.js";
import type { PublicPortfolioAnswerer } from "./public-answer-service.js";
import type { PublicJobFitComparer } from "./public-job-fit-service.js";
import {
  PublicContactQueueUnavailableError,
  type PublicContactIntentStager,
} from "./public-contact-intent-queue.js";
import type { PublicRequestAdmissionController } from "./public-request-admission.js";
import type {
  PublicAuditCounts,
  PublicAuditMethod,
  PublicAuditOperation,
  PublicAuditOutcome,
  PublicAuditRecorder,
} from "./public-audit-ledger.js";
import {
  assertPublicResponseDisclosureSafe,
} from "../domain/public-disclosure-policy.js";
import type {
  PublicOperationalMeasurement,
  PublicOperationalTelemetry,
} from "./public-operational-telemetry.js";

const MAX_URL_CHARACTERS = 2_048;
const MAX_BODY_BYTES = 98_304;
const SECURITY_HEADERS = {
  "cache-control": "no-store",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
} as const;

export interface PublicDelegateServerOptions {
  readonly enabled: boolean;
  readonly artifacts: PublicArtifactSource;
  readonly answers: PublicPortfolioAnswerer;
  readonly jobFit: PublicJobFitComparer;
  readonly contactIntents: PublicContactIntentStager;
  readonly admissions: PublicRequestAdmissionController;
  readonly audits?: PublicAuditRecorder;
  readonly telemetry?: PublicOperationalTelemetry;
  readonly apiToken?: string;
  readonly requestId?: () => `req:${string}`;
}

export function createPublicDelegateServer(
  options: PublicDelegateServerOptions,
): Server {
  const server = createServer(
    { maxHeaderSize: 16_384 },
    async (request, response) => {
      const requestId = (options.requestId ?? createPublicRequestId)();
      const measurement = options.telemetry?.begin({
        operation: auditOperation(request.url ?? "/"),
        method: auditMethod(request.method),
      });
      response.once("close", () => {
        if (!response.writableFinished) {
          measurement?.complete({ status: 499, outcome: "request_aborted" });
        }
      });
      const respond = createAuditedResponder(
        request,
        response,
        options.audits,
        measurement,
        requestId,
      );
      if (!options.enabled) {
        await respond(
          503,
          publicError("public_delegate_disabled", requestId),
          "disabled",
        );
        return;
      }
      if (
        requiresAuthorization(request.url) &&
        options.apiToken &&
        !hasValidBearerToken(request.headers.authorization, options.apiToken)
      ) {
        await respond(
          401,
          publicError("unauthorized", requestId),
          "unauthorized",
          { "www-authenticate": "Bearer" },
        );
        return;
      }
      const admission = options.admissions.acquire(
        request.socket.remoteAddress ?? "unknown",
      );
      if (!admission.accepted) {
        await respond(
          admission.status,
          publicError(
            admission.code,
            requestId,
            admission.retryAfterSeconds,
          ),
          admission.status === 503 ? "busy" : "rate_limited",
          { "retry-after": String(admission.retryAfterSeconds) },
        );
        return;
      }
      try {
        await handleRequest(request, options, respond, requestId);
      } catch (error) {
        if (error instanceof PublicRequestError) {
          await respond(
            error.status,
            publicError(error.code, requestId),
            requestErrorOutcome(error.code),
          );
          return;
        }
        if (error instanceof PublicArtifactVersionMismatchError) {
          await respond(
            503,
            publicError("version_mismatch", requestId),
            "public_evidence_unavailable",
          );
          return;
        }
        if (error instanceof PublicContactQueueUnavailableError) {
          await respond(
            503,
            publicError("contact_queue_unavailable", requestId),
            "contact_queue_unavailable",
          );
          return;
        }
        await respond(
          503,
          publicError("public_evidence_unavailable", requestId),
          "public_evidence_unavailable",
        );
      } finally {
        admission.release();
      }
    },
  );
  server.headersTimeout = 5_000;
  server.requestTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 64;
  server.maxRequestsPerSocket = 100;
  return server;
}

function requiresAuthorization(rawUrl: string | undefined): boolean {
  if (!rawUrl || rawUrl.length > MAX_URL_CHARACTERS) return false;
  try {
    return new URL(rawUrl, "http://127.0.0.1").pathname.startsWith("/v1/");
  } catch {
    return false;
  }
}

function hasValidBearerToken(
  authorization: string | undefined,
  expectedToken: string,
): boolean {
  const match = authorization?.match(/^Bearer ([^\s]+)$/i);
  const suppliedDigest = createHash("sha256").update(match?.[1] ?? "").digest();
  const expectedDigest = createHash("sha256").update(expectedToken).digest();
  return Boolean(match) && timingSafeEqual(suppliedDigest, expectedDigest);
}

async function handleRequest(
  request: IncomingMessage,
  options: PublicDelegateServerOptions,
  respond: PublicAuditedResponder,
  requestId: `req:${string}`,
): Promise<void> {
  const rawUrl = request.url ?? "/";
  if (rawUrl.length > MAX_URL_CHARACTERS) {
    await respond(
      414,
      publicError("uri_too_long", requestId),
      "uri_too_long",
    );
    return;
  }
  const pathname = new URL(rawUrl, "http://127.0.0.1").pathname;
  const expectedMethod = pathname === "/health" ||
      pathname === "/v1/public-evidence/manifest"
    ? "GET"
    : pathname === "/v1/portfolio/answer" ||
        pathname === "/v1/portfolio/job-fit" ||
        pathname === "/v1/portfolio/contact-intent"
      ? "POST"
      : null;

  if (expectedMethod && request.method !== expectedMethod) {
    await respond(
      405,
      publicError("method_not_allowed", requestId),
      "method_not_allowed",
      { allow: expectedMethod },
    );
    return;
  }
  if (!expectedMethod) {
    await respond(
      404,
      publicError("not_found", requestId),
      "not_found",
    );
    return;
  }

  if (pathname === "/health") {
    const artifact = await requireArtifact(options.artifacts);
    await respond(200, {
      status: "ok",
      schemaVersion: artifact.manifest.schemaVersion,
      corpusVersion: artifact.manifest.corpusVersion,
      evidenceCount: artifact.manifest.evidenceCount,
    }, "ok", undefined, {
      corpusVersion: artifact.manifest.corpusVersion,
      counts: { evidenceCount: artifact.manifest.evidenceCount },
    });
    return;
  }
  if (pathname === "/v1/public-evidence/manifest") {
    const artifact = await requireArtifact(options.artifacts);
    await respond(200, artifact.manifest, "ok", undefined, {
      corpusVersion: artifact.manifest.corpusVersion,
      counts: { evidenceCount: artifact.manifest.evidenceCount },
    });
    return;
  }

  const contentType = request.headers["content-type"]
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    throw new PublicRequestError(415, "unsupported_media_type");
  }
  const input = await readJson(request);
  if (pathname === "/v1/portfolio/contact-intent") {
    const parsed = contactIntentRequestSchema.safeParse(input);
    if (!parsed.success) throw new PublicRequestError(400, "invalid_request");
    await respond(
      202,
      await options.contactIntents.stage(parsed.data),
      "accepted",
    );
    return;
  }
  if (pathname === "/v1/portfolio/answer") {
    const parsed = portfolioAnswerRequestSchema.safeParse(input);
    if (!parsed.success) throw new PublicRequestError(400, "invalid_request");
    const artifact = await requireArtifact(options.artifacts);
    const execution = await options.answers.execute(artifact, parsed.data);
    const result = execution.response;
    await respond(
      200,
      result,
      result.claims.length === 0
        ? "no_evidence"
        : execution.mode === "model"
          ? "model_supported"
          : execution.mode === "budget_fallback"
            ? "model_budget_fallback"
            : execution.mode === "fallback"
              ? "model_fallback"
              : "supported",
      undefined,
      {
        corpusVersion: result.corpusVersion,
        counts: {
          claimCount: result.claims.length,
          citationCount: result.citations.length,
        },
      },
    );
    return;
  }
  const parsed = portfolioJobFitRequestSchema.safeParse(input);
  if (!parsed.success) throw new PublicRequestError(400, "invalid_request");
  const artifact = await requireArtifact(options.artifacts);
  const result = options.jobFit.compare(artifact, parsed.data);
  await respond(200, result, "compared", undefined, {
    corpusVersion: result.corpusVersion,
    counts: {
      requirementCount: result.requirements.length,
      citationCount: result.citations.length,
      directCount: result.requirements.filter((item) => item.assessment === "direct").length,
      adjacentCount: result.requirements.filter((item) => item.assessment === "adjacent").length,
      unknownCount: result.requirements.filter((item) => item.assessment === "unknown").length,
    },
  });
}

async function requireArtifact(
  source: PublicArtifactSource,
): Promise<PublicCareerEvidenceArtifact> {
  const artifact = await source.read();
  if (!artifact) throw new Error("Public evidence is unavailable.");
  return artifact;
}

interface PublicAuditDetails {
  readonly corpusVersion?: string;
  readonly counts?: PublicAuditCounts;
}

type PublicAuditedResponder = (
  status: number,
  body: unknown,
  outcome: PublicAuditOutcome,
  headers?: Readonly<Record<string, string>>,
  details?: PublicAuditDetails,
) => Promise<void>;

function createAuditedResponder(
  request: IncomingMessage,
  response: ServerResponse,
  audits: PublicAuditRecorder | undefined,
  measurement: PublicOperationalMeasurement | undefined,
  requestId: `req:${string}`,
): PublicAuditedResponder {
  const startedAt = Date.now();
  const operation = auditOperation(request.url ?? "/");
  const method = auditMethod(request.method);
  return async (status, body, outcome, headers = {}, details = {}) => {
    const guarded = guardPublicResponse(
      status,
      body,
      outcome,
      headers,
      details,
      requestId,
    );
    measurement?.complete({
      status: guarded.status,
      outcome: guarded.outcome,
    });
    if (audits) {
      try {
        void audits.record({
          operation,
          method,
          status: guarded.status,
          outcome: guarded.outcome,
          durationMs: Date.now() - startedAt,
          ...guarded.details,
        }).catch(() => undefined);
      } catch {
        // Auditing is best-effort and must never change the public response.
      }
    }
    sendJson(response, guarded.status, guarded.body, guarded.headers);
  };
}

function guardPublicResponse(
  status: number,
  body: unknown,
  outcome: PublicAuditOutcome,
  headers: Readonly<Record<string, string>>,
  details: PublicAuditDetails,
  requestId: `req:${string}`,
) {
  try {
    assertPublicResponseDisclosureSafe(body);
    return { status, body, outcome, headers, details };
  } catch {
    return {
      status: 503,
      body: publicError("public_response_blocked", requestId),
      outcome: "response_blocked" as const,
      headers: {},
      details: {},
    };
  }
}

function auditOperation(rawUrl: string): PublicAuditOperation {
  if (rawUrl.length > MAX_URL_CHARACTERS) return "unknown";
  try {
    const pathname = new URL(rawUrl, "http://127.0.0.1").pathname;
    if (pathname === "/health") return "health";
    if (pathname === "/v1/public-evidence/manifest") return "manifest";
    if (pathname === "/v1/portfolio/answer") return "answer";
    if (pathname === "/v1/portfolio/job-fit") return "job_fit";
    if (pathname === "/v1/portfolio/contact-intent") return "contact_intent";
    return "unknown";
  } catch {
    return "unknown";
  }
}

function auditMethod(method: string | undefined): PublicAuditMethod {
  return method === "GET" || method === "POST" ? method : "OTHER";
}

function requestErrorOutcome(code: string): PublicAuditOutcome {
  switch (code) {
    case "invalid_request":
    case "invalid_json":
    case "payload_too_large":
    case "unsupported_media_type":
      return code;
    default:
      return "invalid_request";
  }
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Readonly<Record<string, string>> = {},
): void {
  response.writeHead(status, {
    ...SECURITY_HEADERS,
    ...headers,
    "content-type": "application/json; charset=utf-8",
  });
  response.end(`${JSON.stringify(body)}\n`);
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      throw new PublicRequestError(413, "payload_too_large");
    }
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new PublicRequestError(400, "invalid_json");
  }
}

class PublicRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
    this.name = "PublicRequestError";
  }
}

function createPublicRequestId(): `req:${string}` {
  return `req:${randomBytes(16).toString("hex")}`;
}

function publicError(
  internalCode: string,
  requestId: `req:${string}`,
  retryAfterSeconds?: number,
): PublicJoleneErrorResponse {
  const code = publicErrorCode(internalCode);
  return publicJoleneErrorResponseSchema.parse({
    schemaVersion: PUBLIC_CAREER_EVIDENCE_SCHEMA_VERSION,
    code,
    message: PUBLIC_ERROR_MESSAGES[code],
    requestId,
    ...(retryAfterSeconds ? { retryAfterSeconds } : {}),
    ...(code === "version_mismatch"
      ? { supportedSchemaVersions: [PUBLIC_CAREER_EVIDENCE_SCHEMA_VERSION] }
      : {}),
  });
}

function publicErrorCode(internalCode: string): PublicJoleneErrorCode {
  switch (internalCode) {
    case "rate_limited":
      return "rate_limited";
    case "version_mismatch":
      return "version_mismatch";
    case "invalid_request":
    case "invalid_json":
    case "payload_too_large":
    case "unsupported_media_type":
      return "invalid_request";
    case "method_not_allowed":
    case "not_found":
    case "uri_too_long":
    case "unauthorized":
      return "request_rejected";
    default:
      return "unavailable";
  }
}

const PUBLIC_ERROR_MESSAGES: Readonly<Record<PublicJoleneErrorCode, string>> = {
  invalid_request: "The request could not be accepted.",
  unavailable: "Public Jolene is temporarily unavailable.",
  rate_limited: "Too many requests. Please try again later.",
  budget_exhausted: "The public response budget is temporarily exhausted.",
  version_mismatch: "This public Jolene response version is not supported.",
  request_rejected: "The requested operation is not available.",
};
