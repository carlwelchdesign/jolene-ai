import { once } from "node:events";
import { createServer } from "node:http";
import { createConnection } from "node:net";

import { describe, expect, it } from "vitest";

import { closePublicServers } from "../src/public/public-server-lifecycle.js";

describe("public server lifecycle", () => {
  it("closes multiple idle listeners gracefully", async () => {
    const first = createServer((_request, response) => response.end("ok"));
    const second = createServer((_request, response) => response.end("ok"));
    first.listen(0, "127.0.0.1");
    second.listen(0, "127.0.0.1");
    await Promise.all([once(first, "listening"), once(second, "listening")]);

    await expect(closePublicServers([first, second], 500)).resolves.toEqual({
      forced: false,
      serverCount: 2,
    });
    expect(first.listening).toBe(false);
    expect(second.listening).toBe(false);
  });

  it("force-closes a request that cannot drain before the deadline", async () => {
    let markRequestStarted: (() => void) | undefined;
    const requestStarted = new Promise<void>((resolve) => {
      markRequestStarted = resolve;
    });
    const server = createServer(async (request) => {
      markRequestStarted?.();
      try {
        for await (const _chunk of request) {
          // Deliberately wait for the incomplete body so shutdown must force-close.
        }
      } catch {
        // Forced shutdown intentionally aborts this incomplete request.
      }
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const bound = server.address();
    if (!bound || typeof bound === "string") throw new Error("Expected TCP server.");
    const socket = createConnection(bound.port, "127.0.0.1");
    socket.on("error", () => undefined);
    await once(socket, "connect");
    socket.write("POST / HTTP/1.1\r\nHost: localhost\r\nContent-Length: 100\r\n\r\nx");
    await requestStarted;

    await expect(closePublicServers([server], 100)).resolves.toEqual({
      forced: true,
      serverCount: 1,
    });
    socket.destroy();
  });

  it("validates shutdown bounds and handles already-closed servers", async () => {
    const server = createServer();
    await expect(closePublicServers([server], 99)).rejects.toThrow("100-30000ms");
    await expect(closePublicServers([server], 100)).resolves.toEqual({
      forced: false,
      serverCount: 0,
    });
  });
});
