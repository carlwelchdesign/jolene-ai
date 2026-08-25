import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { ZodError } from "zod";

import { createApplication } from "./app.js";
import { chatRequestSchema } from "./application/jolene-service.js";
import { loadConfig } from "./config.js";

const MAX_REQUEST_BYTES = 1_000_000;

const config = loadConfig();
const application = await createApplication(config);

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

class RequestTooLargeError extends Error {}
