import { describe, expect, it, vi } from "vitest";

import {
  RedisRestCoordinationClient,
  SharedCoordinationUnavailableError,
} from "../src/public/redis-rest-coordination-client.js";

const endpoint = "https://jolene-coordination.example.test";
const token = "test-coordination-token-with-32-characters";

describe("RedisRestCoordinationClient", () => {
  it("runs a content-free protocol preflight through an exact HTTPS host", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
      const commands = JSON.parse(String(init?.body));
      if (commands[0] === "EVAL") {
        expect(commands).toContain("jolene-public:preflight:probe");
        return jsonResponse({ result: commands.at(-1) });
      }
      expect(commands[0]).toEqual(["PING"]);
      expect(commands[1]?.[0]).toBe("ECHO");
      expect(commands[1]).toHaveLength(2);
      const challenge = commands[1][1];
      return jsonResponse([{ result: "PONG" }, { result: challenge }]);
    });
    const client = createClient(fetch);

    await expect(client.preflight()).resolves.toMatchObject({
      protocol: "redis-rest-json-array",
      status: "ready",
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe(`${endpoint}/multi-exec`);
    expect(init).toMatchObject({ method: "POST", redirect: "error" });
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${token}`);
  });

  it("builds only opaque namespaced keys and encodes EVAL safely", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
      const command = JSON.parse(String(init?.body));
      expect(command).toEqual([
        "EVAL",
        "return ARGV[1]",
        1,
        "jolene-public:admission:window",
        "opaque-value",
      ]);
      return jsonResponse({ result: "opaque-value" });
    });
    const client = createClient(fetch);
    expect(client.key("admission", "window")).toBe("jolene-public:admission:window");
    await expect(client.evaluate(
      "return ARGV[1]",
      [client.key("admission", "window")],
      ["opaque-value"],
    )).resolves.toBe("opaque-value");
    expect(() => client.key("../../private")) .toThrow();
    await expect(client.command(["FLUSHALL"])).rejects.toThrow();
    await expect(client.evaluate("return 1", ["other:key"], []))
      .rejects.toThrow("namespaced keys");
  });

  it("rejects non-HTTPS, credentials, paths, and non-allowlisted hosts", () => {
    for (const url of [
      "http://jolene-coordination.example.test",
      "https://user:pass@jolene-coordination.example.test",
      "https://jolene-coordination.example.test/private",
      "https://localhost",
      "https://other.example.test",
    ]) {
      expect(() => new RedisRestCoordinationClient({
        url,
        token,
        allowedHosts: ["jolene-coordination.example.test"],
        namespace: "jolene-public",
      })).toThrow();
    }
  });

  it("fails closed and never reproduces credentials or provider bodies", async () => {
    const providerBody = `WRONGPASS ${token} private prompt and path`;
    for (const response of [
      () => jsonResponse({ error: providerBody }),
      () => new Response(providerBody, { status: 503 }),
      () => new Response("not-json", { status: 200 }),
      () => jsonResponse({ result: { unsupported: true } }),
    ]) {
      const client = createClient(vi.fn<typeof globalThis.fetch>(async () => response()));
      let observed: unknown;
      try {
        await client.command(["PING"]);
      } catch (error) {
        observed = error;
      }
      expect(observed).toBeInstanceOf(SharedCoordinationUnavailableError);
      expect(String(observed)).toBe("SharedCoordinationUnavailableError: Shared coordination is unavailable.");
      expect(String(observed)).not.toContain(token);
      expect(String(observed)).not.toContain("private prompt");
    }
  });

  it("rejects oversized responses and timeouts with the same safe error", async () => {
    const oversized = createClient(vi.fn<typeof globalThis.fetch>(async () =>
      new Response(JSON.stringify({ result: "x".repeat(2_000) }), {
        headers: { "content-length": "2030" },
      })
    ), { maximumResponseBytes: 1_024 });
    await expect(oversized.command(["PING"]))
      .rejects.toBeInstanceOf(SharedCoordinationUnavailableError);

    const timedOut = createClient(vi.fn<typeof globalThis.fetch>(async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })
    ), { timeoutMilliseconds: 250 });
    await expect(timedOut.command(["PING"]))
      .rejects.toBeInstanceOf(SharedCoordinationUnavailableError);
  });
});

function createClient(
  fetch: typeof globalThis.fetch,
  overrides: Partial<{ timeoutMilliseconds: number; maximumResponseBytes: number }> = {},
): RedisRestCoordinationClient {
  return new RedisRestCoordinationClient({
    url: endpoint,
    token,
    allowedHosts: ["jolene-coordination.example.test"],
    namespace: "jolene-public",
    fetch,
    ...overrides,
  });
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
