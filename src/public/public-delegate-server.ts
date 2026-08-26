import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

import type { PublicCareerEvidenceArtifact } from "../domain/public-career-evidence.js";
import type { PublicArtifactSource } from "./public-artifact-source.js";

const MAX_URL_CHARACTERS = 2_048;
const SECURITY_HEADERS = {
  "cache-control": "no-store",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
} as const;

export interface PublicDelegateServerOptions {
  readonly artifacts: PublicArtifactSource;
}

export function createPublicDelegateServer(
  options: PublicDelegateServerOptions,
): Server {
  const server = createServer(
    { maxHeaderSize: 16_384 },
    async (request, response) => {
      try {
        await handleRequest(request, response, options);
      } catch {
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
  const knownPath = pathname === "/health" ||
    pathname === "/v1/public-evidence/manifest";

  if (knownPath && request.method !== "GET") {
    response.setHeader("allow", "GET");
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }
  if (!knownPath) {
    sendJson(response, 404, { error: "not_found" });
    return;
  }

  const artifact = await requireArtifact(options.artifacts);
  if (pathname === "/health") {
    sendJson(response, 200, {
      status: "ok",
      schemaVersion: artifact.manifest.schemaVersion,
      corpusVersion: artifact.manifest.corpusVersion,
      evidenceCount: artifact.manifest.evidenceCount,
    });
    return;
  }
  sendJson(response, 200, artifact.manifest);
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
