import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { ZodError } from "zod";

import { createApplication } from "./app.js";
import { chatRequestSchema } from "./application/jolene-service.js";
import { loadConfig } from "./config.js";
import {
  DurableMemoryConflictError,
  DurableMemoryNotFoundError,
  MemoryProposalConflictError,
  MemoryProposalNotFoundError,
  WorkTaskNotFoundError,
} from "./domain/work-context.js";
import {
  loadMemoryReviewAssets,
  memoryReviewHeaders,
  type MemoryReviewAsset,
} from "./ui/memory-review-assets.js";

const MAX_REQUEST_BYTES = 1_000_000;

const config = loadConfig();
const application = await createApplication(config);
const memoryReviewAssets = loadMemoryReviewAssets();

const server = createServer(async (request, response) => {
  try {
    await handleRequest(request, response);
  } catch (error) {
    handleError(error, response);
  }
});

server.listen(config.port, "127.0.0.1", () => {
  process.stdout.write(
    `Jolene is listening at http://127.0.0.1:${config.port}\n`,
  );
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      application.close();
      process.exit(0);
    });
  });
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");

  if (request.method === "GET" && url.pathname === "/") {
    response.writeHead(302, {
      location: "/memory",
      "cache-control": "no-store",
    });
    response.end();
    return;
  }

  if (request.method === "GET" && url.pathname === "/memory") {
    sendAsset(response, memoryReviewAssets.html);
    return;
  }

  if (request.method === "GET" && url.pathname === "/memory-review.css") {
    sendAsset(response, memoryReviewAssets.css);
    return;
  }

  if (request.method === "GET" && url.pathname === "/memory-review.js") {
    sendAsset(response, memoryReviewAssets.javascript);
    return;
  }

  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, application.health());
    return;
  }

  if (request.method === "POST" && url.pathname === "/v1/chat") {
    const body = chatRequestSchema.parse(await readJson(request));
    const result = await application.service.chat(body);
    sendJson(response, result.status === "processing" ? 202 : 200, result);
    return;
  }

  if (request.method === "POST" && url.pathname === "/v1/tasks") {
    sendJson(response, 201, application.work.createTask(await readJson(request)));
    return;
  }

  if (request.method === "GET" && url.pathname === "/v1/tasks") {
    sendJson(
      response,
      200,
      application.work.listTasks({
        actorId: url.searchParams.get("actorId"),
        workspaceId: url.searchParams.get("workspaceId"),
        status: url.searchParams.get("status") ?? undefined,
      }),
    );
    return;
  }

  const taskStatusMatch = url.pathname.match(/^\/v1\/tasks\/([^/]+)\/status$/);
  if (request.method === "PATCH" && taskStatusMatch?.[1]) {
    sendJson(
      response,
      200,
      application.work.updateTaskStatus(
        withIdentifier(await readJson(request), taskStatusMatch[1]),
      ),
    );
    return;
  }

  if (request.method === "POST" && url.pathname === "/v1/memory-proposals") {
    sendJson(
      response,
      201,
      application.work.proposeMemory(await readJson(request)),
    );
    return;
  }

  if (request.method === "GET" && url.pathname === "/v1/memory-proposals") {
    sendJson(response, 200, application.work.listMemoryProposals({
      actorId: url.searchParams.get("actorId"),
      workspaceId: url.searchParams.get("workspaceId"),
      status: url.searchParams.get("status") ?? undefined,
    }));
    return;
  }

  if (request.method === "GET" && url.pathname === "/v1/memories") {
    sendJson(
      response,
      200,
      application.work.listMemories({
        actorId: url.searchParams.get("actorId"),
        workspaceId: url.searchParams.get("workspaceId"),
      }),
    );
    return;
  }

  if (request.method === "POST" && url.pathname === "/v1/context-preview") {
    sendJson(
      response,
      200,
      application.work.previewContext(await readJson(request)),
    );
    return;
  }

  const forgetMatch = url.pathname.match(/^\/v1\/memories\/([^/]+)\/forget$/);
  if (request.method === "POST" && forgetMatch?.[1]) {
    sendJson(
      response,
      200,
      application.work.forgetMemory(
        withIdentifier(await readJson(request), forgetMatch[1]),
      ),
    );
    return;
  }

  const decisionMatch = url.pathname.match(
    /^\/v1\/memory-proposals\/([^/]+)\/decision$/,
  );
  if (request.method === "POST" && decisionMatch?.[1]) {
    sendJson(
      response,
      200,
      application.work.decideMemory(
        withIdentifier(await readJson(request), decisionMatch[1]),
      ),
    );
    return;
  }

  sendJson(response, 404, { error: "not_found" });
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_REQUEST_BYTES) {
      throw new RequestTooLargeError();
    }
    chunks.push(buffer);
  }

  const text = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(text || "{}");
}

function handleError(error: unknown, response: ServerResponse): void {
  if (error instanceof ZodError || error instanceof SyntaxError) {
    sendJson(response, 400, { error: "invalid_request" });
    return;
  }

  if (error instanceof RequestTooLargeError) {
    sendJson(response, 413, { error: "request_too_large" });
    return;
  }

  if (
    error instanceof WorkTaskNotFoundError ||
    error instanceof MemoryProposalNotFoundError ||
    error instanceof DurableMemoryNotFoundError
  ) {
    sendJson(response, 404, { error: "not_found" });
    return;
  }

  if (error instanceof MemoryProposalConflictError) {
    sendJson(response, 409, { error: "decision_conflict" });
    return;
  }

  if (error instanceof DurableMemoryConflictError) {
    sendJson(response, 409, { error: "memory_conflict" });
    return;
  }

  process.stderr.write(
    `Jolene request failed: ${error instanceof Error ? error.name : "UnknownError"}\n`,
  );
  sendJson(response, 502, { error: "agent_unavailable" });
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

function sendAsset(response: ServerResponse, asset: MemoryReviewAsset): void {
  response.writeHead(
    200,
    memoryReviewHeaders(asset.contentType, asset.body.byteLength),
  );
  response.end(asset.body);
}

class RequestTooLargeError extends Error {}

function withIdentifier(body: unknown, id: string): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new SyntaxError("Expected a JSON object.");
  }

  return { ...(body as Record<string, unknown>), id };
}
