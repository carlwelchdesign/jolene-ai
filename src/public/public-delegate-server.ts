import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

import type { PublicCareerEvidenceArtifact } from "../domain/public-career-evidence.js";
import {
  portfolioAnswerRequestSchema,
  portfolioJobFitRequestSchema,
} from "../domain/public-portfolio-contract.js";
import type { PublicArtifactSource } from "./public-artifact-source.js";
import type { PublicPortfolioAnswerer } from "./public-answer-service.js";
import type { PublicJobFitComparer } from "./public-job-fit-service.js";

const MAX_URL_CHARACTERS = 2_048;
const MAX_BODY_BYTES = 98_304;
const SECURITY_HEADERS = {
  "cache-control": "no-store",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
} as const;

export interface PublicDelegateServerOptions {
  readonly artifacts: PublicArtifactSource;
  readonly answers: PublicPortfolioAnswerer;
  readonly jobFit: PublicJobFitComparer;
}

export function createPublicDelegateServer(
  options: PublicDelegateServerOptions,
): Server {
  const server = createServer(
    { maxHeaderSize: 16_384 },
    async (request, response) => {
      try {
        await handleRequest(request, response, options);
      } catch (error) {
        if (error instanceof PublicRequestError) {
          sendJson(response, error.status, { error: error.code });
          return;
        }
        sendJson(response, 503, {
          status: "unavailable",
          error: "public_evidence_unavailable",
        });
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

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: PublicDelegateServerOptions,
): Promise<void> {
  const rawUrl = request.url ?? "/";
  if (rawUrl.length > MAX_URL_CHARACTERS) {
    sendJson(response, 414, { error: "uri_too_long" });
    return;
  }
  const pathname = new URL(rawUrl, "http://127.0.0.1").pathname;
  const expectedMethod = pathname === "/health" ||
      pathname === "/v1/public-evidence/manifest"
    ? "GET"
    : pathname === "/v1/portfolio/answer" ||
        pathname === "/v1/portfolio/job-fit"
      ? "POST"
      : null;

  if (expectedMethod && request.method !== expectedMethod) {
    response.setHeader("allow", expectedMethod);
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }
  if (!expectedMethod) {
    sendJson(response, 404, { error: "not_found" });
    return;
  }

  if (pathname === "/health") {
    const artifact = await requireArtifact(options.artifacts);
    sendJson(response, 200, {
      status: "ok",
      schemaVersion: artifact.manifest.schemaVersion,
      corpusVersion: artifact.manifest.corpusVersion,
      evidenceCount: artifact.manifest.evidenceCount,
    });
    return;
  }
  if (pathname === "/v1/public-evidence/manifest") {
    const artifact = await requireArtifact(options.artifacts);
    sendJson(response, 200, artifact.manifest);
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
  if (pathname === "/v1/portfolio/answer") {
    const parsed = portfolioAnswerRequestSchema.safeParse(input);
    if (!parsed.success) throw new PublicRequestError(400, "invalid_request");
    const artifact = await requireArtifact(options.artifacts);
    sendJson(response, 200, options.answers.answer(artifact, parsed.data));
    return;
  }
  const parsed = portfolioJobFitRequestSchema.safeParse(input);
  if (!parsed.success) throw new PublicRequestError(400, "invalid_request");
  const artifact = await requireArtifact(options.artifacts);
  sendJson(response, 200, options.jobFit.compare(artifact, parsed.data));
}

async function requireArtifact(
  source: PublicArtifactSource,
): Promise<PublicCareerEvidenceArtifact> {
  const artifact = await source.read();
  if (!artifact) throw new Error("Public evidence is unavailable.");
  return artifact;
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
): void {
  response.writeHead(status, {
    ...SECURITY_HEADERS,
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
