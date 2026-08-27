import { createServer, type Server, type ServerResponse } from "node:http";

import { z } from "zod";

import type { PublicOperationalTelemetry } from "./public-operational-telemetry.js";

const COMPONENTS = [
  "delegate",
  "publicEvidence",
  "contactIntentQueue",
  "auditLedger",
  "modelRequestBudget",
] as const;

const componentStateSchema = z.enum([
  "ready",
  "unavailable",
  "degraded",
  "disabled",
  "not_required",
]);

export const publicReadinessSnapshotSchema = z.object({
  schemaVersion: z.literal("jolene.public-operations.v1"),
  status: z.enum(["ready", "degraded", "unready"]),
  checkedAt: z.string().datetime({ offset: true }),
  components: z.object(Object.fromEntries(COMPONENTS.map((name) => [
    name,
    componentStateSchema,
  ])) as { [K in typeof COMPONENTS[number]]: typeof componentStateSchema }).strict(),
}).strict();

export const publicLivenessSnapshotSchema = z.object({
  schemaVersion: z.literal("jolene.public-operations.v1"),
  status: z.literal("alive"),
  startedAt: z.string().datetime({ offset: true }),
}).strict();

const publicOperationsFixedStatusSchema = z.object({
  schemaVersion: z.literal("jolene.public-operations.v1"),
  status: z.enum([
    "method_not_allowed",
    "not_found",
    "readiness_unavailable",
    "operations_unavailable",
  ]),
}).strict();

export type PublicReadinessSnapshot = z.infer<
  typeof publicReadinessSnapshotSchema
>;

export interface PublicOperationsServerOptions {
  readonly telemetry: PublicOperationalTelemetry;
  readonly readiness: () => Promise<PublicReadinessSnapshot>;
  readonly now?: () => Date;
}

const SECURITY_HEADERS = {
  "cache-control": "no-store",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
} as const;

export function createPublicOperationsServer(
  options: PublicOperationsServerOptions,
): Server {
  const startedAt = (options.now ?? (() => new Date()))();
  const server = createServer({ maxHeaderSize: 4_096 }, async (request, response) => {
    try {
      const pathname = safePathname(request.url);
      if (request.method !== "GET") {
        sendJson(response, 405, fixedStatus("method_not_allowed"), { allow: "GET" });
        return;
      }
      if (pathname === "/live") {
        sendJson(response, 200, publicLivenessSnapshotSchema.parse({
          schemaVersion: "jolene.public-operations.v1",
          status: "alive",
          startedAt: startedAt.toISOString(),
        }));
        return;
      }
      if (pathname === "/ready") {
        try {
          const readiness = publicReadinessSnapshotSchema.parse(
            await options.readiness(),
          );
          sendJson(response, readiness.status === "unready" ? 503 : 200, readiness);
        } catch {
          sendJson(response, 503, fixedStatus("readiness_unavailable"));
        }
        return;
      }
      if (pathname === "/metrics") {
        sendJson(response, 200, options.telemetry.snapshot());
        return;
      }
      sendJson(response, 404, fixedStatus("not_found"));
    } catch {
      if (!response.headersSent) {
        sendJson(response, 503, fixedStatus("operations_unavailable"));
      } else {
        response.destroy();
      }
    }
  });
  server.headersTimeout = 3_000;
  server.requestTimeout = 3_000;
  server.keepAliveTimeout = 3_000;
  server.maxHeadersCount = 24;
  server.maxRequestsPerSocket = 25;
  return server;
}

export function buildPublicReadinessSnapshot(input: {
  readonly checkedAt: Date;
  readonly delegateEnabled: boolean;
  readonly publicEvidenceReady: boolean;
  readonly contactIntentQueueReady: boolean;
  readonly auditLedgerReady: boolean;
  readonly modelRequestBudget: "ready" | "unavailable" | "not_required";
}): PublicReadinessSnapshot {
  const unready = !input.delegateEnabled || !input.publicEvidenceReady ||
    !input.contactIntentQueueReady;
  const degraded = !input.auditLedgerReady ||
    input.modelRequestBudget === "unavailable";
  return publicReadinessSnapshotSchema.parse({
    schemaVersion: "jolene.public-operations.v1",
    status: unready ? "unready" : degraded ? "degraded" : "ready",
    checkedAt: input.checkedAt.toISOString(),
    components: {
      delegate: input.delegateEnabled ? "ready" : "disabled",
      publicEvidence: input.publicEvidenceReady ? "ready" : "unavailable",
      contactIntentQueue: !input.delegateEnabled
        ? "disabled"
        : input.contactIntentQueueReady ? "ready" : "unavailable",
      auditLedger: input.auditLedgerReady ? "ready" : "degraded",
      modelRequestBudget: input.modelRequestBudget,
    },
  });
}

function fixedStatus(status: string) {
  return publicOperationsFixedStatusSchema.parse({
    schemaVersion: "jolene.public-operations.v1",
    status,
  });
}

function safePathname(rawUrl: string | undefined): string {
  if (!rawUrl || rawUrl.length > 512) return "/invalid";
  try {
    return new URL(rawUrl, "http://127.0.0.1").pathname;
  } catch {
    return "/invalid";
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
