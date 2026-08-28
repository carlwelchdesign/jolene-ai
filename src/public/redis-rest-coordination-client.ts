import { createHash } from "node:crypto";

import { z } from "zod";

const redisScalarSchema = z.union([z.string(), z.number().finite().safe()]);
const redisResultSchema: z.ZodType<RedisResult> = z.lazy(() => z.union([
  z.null(),
  z.string(),
  z.number().finite().safe(),
  z.array(redisResultSchema),
]));

const redisResponseSchema = z.union([
  z.object({ result: redisResultSchema }).strict(),
  z.object({ error: z.string().min(1).max(4_096) }).strict(),
]);

const namespaceSchema = z.string().regex(/^[a-z][a-z0-9-]{2,31}$/);
const keySegmentSchema = z.string().regex(/^[a-z][a-z0-9-]{1,47}$/);
const allowedCommandSchema = z.enum(["PING", "ECHO", "EVAL"]);
const hostnameSchema = z.string().trim().min(1).max(253).transform((value) =>
  value.toLowerCase().replace(/\.$/, "")
);

export type RedisScalar = z.infer<typeof redisScalarSchema>;
export type RedisResult = null | string | number | RedisResult[];

export interface RedisRestCoordinationClientOptions {
  readonly url: string;
  readonly token: string;
  readonly allowedHosts: readonly string[];
  readonly namespace: string;
  readonly timeoutMilliseconds?: number;
  readonly maximumResponseBytes?: number;
  readonly fetch?: typeof globalThis.fetch;
}

export interface RedisRestCoordinationHealth {
  readonly schemaVersion: "jolene.redis-rest-coordination-health.v1";
  readonly protocol: "redis-rest-json-array";
  readonly protocolFingerprint: string;
  readonly status: "ready";
}

export class RedisRestCoordinationClient {
  readonly #url: string;
  readonly #token: string;
  readonly #namespace: string;
  readonly #timeoutMilliseconds: number;
  readonly #maximumResponseBytes: number;
  readonly #fetch: typeof globalThis.fetch;

  constructor(options: RedisRestCoordinationClientOptions) {
    this.#url = normalizeEndpoint(options.url, options.allowedHosts);
    this.#token = z.string().trim().min(32).max(4_096).parse(options.token);
    this.#namespace = namespaceSchema.parse(options.namespace);
    this.#timeoutMilliseconds = z.number().int().min(250).max(10_000)
      .parse(options.timeoutMilliseconds ?? 2_000);
    this.#maximumResponseBytes = z.number().int().min(1_024).max(262_144)
      .parse(options.maximumResponseBytes ?? 65_536);
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  key(...segments: readonly string[]): string {
    if (segments.length < 1 || segments.length > 8) {
      throw new Error("Shared coordination keys require between one and eight segments.");
    }
    return [this.#namespace, ...segments.map((segment) => keySegmentSchema.parse(segment))]
      .join(":");
  }

  async command(command: readonly RedisScalar[]): Promise<RedisResult> {
    const parsedCommand = z.array(redisScalarSchema).min(1).max(128).parse(command);
    allowedCommandSchema.parse(parsedCommand[0]);
    return this.#request(this.#url, parsedCommand);
  }

  async transaction(commands: readonly (readonly RedisScalar[])[]): Promise<readonly RedisResult[]> {
    const parsedCommands = z.array(z.array(redisScalarSchema).min(1).max(128))
      .min(1).max(32).parse(commands);
    for (const command of parsedCommands) allowedCommandSchema.parse(command[0]);
    const result = await this.#request(`${this.#url}/multi-exec`, parsedCommands);
    if (!Array.isArray(result)) throw new SharedCoordinationUnavailableError();
    return result;
  }

  async evaluate(
    script: string,
    keys: readonly string[],
    args: readonly RedisScalar[],
  ): Promise<RedisResult> {
    const parsedScript = z.string().min(1).max(16_384).parse(script);
    const parsedKeys = z.array(z.string().min(1).max(512)).max(32).parse(keys);
    if (parsedKeys.some((key) => !key.startsWith(`${this.#namespace}:`))) {
      throw new Error("Shared coordination scripts may access only namespaced keys.");
    }
    const parsedArgs = z.array(redisScalarSchema).max(96).parse(args);
    return this.command(["EVAL", parsedScript, parsedKeys.length, ...parsedKeys, ...parsedArgs]);
  }

  async preflight(): Promise<RedisRestCoordinationHealth> {
    const challenge = createHash("sha256")
      .update(`jolene:${this.#namespace}:redis-rest-json-array:v1`)
      .digest("hex");
    const [ping, echo] = await this.transaction([
      ["PING"],
      ["ECHO", challenge],
    ]);
    if (ping !== "PONG" || echo !== challenge) {
      throw new SharedCoordinationUnavailableError();
    }
    return {
      schemaVersion: "jolene.redis-rest-coordination-health.v1",
      protocol: "redis-rest-json-array",
      protocolFingerprint: createHash("sha256")
        .update("redis-rest-json-array:multi-exec:eval:v1")
        .digest("hex"),
      status: "ready",
    };
  }

  async #request(url: string, body: unknown): Promise<RedisResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMilliseconds);
    timeout.unref?.();
    try {
      const response = await this.#fetch(url, {
        method: "POST",
        redirect: "error",
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${this.#token}`,
          "content-type": "application/json",
          "user-agent": "jolene-ai",
        },
        body: JSON.stringify(body),
      });
      const contentLength = response.headers.get("content-length");
      if (contentLength && Number(contentLength) > this.#maximumResponseBytes) {
        throw new SharedCoordinationUnavailableError();
      }
      const raw = await response.text();
      if (!response.ok || Buffer.byteLength(raw, "utf8") > this.#maximumResponseBytes) {
        throw new SharedCoordinationUnavailableError();
      }
      let json: unknown;
      try {
        json = JSON.parse(raw);
      } catch {
        throw new SharedCoordinationUnavailableError();
      }
      if (url.endsWith("/multi-exec")) {
        const transaction = z.array(redisResponseSchema).min(1).max(32).parse(json);
        if (transaction.some((entry) => "error" in entry)) {
          throw new SharedCoordinationUnavailableError();
        }
        return transaction.map((entry) => "result" in entry ? entry.result : null);
      }
      const parsed = redisResponseSchema.parse(json);
      if ("error" in parsed) throw new SharedCoordinationUnavailableError();
      return parsed.result;
    } catch (error) {
      if (error instanceof SharedCoordinationUnavailableError) throw error;
      throw new SharedCoordinationUnavailableError();
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class SharedCoordinationUnavailableError extends Error {
  constructor() {
    super("Shared coordination is unavailable.");
    this.name = "SharedCoordinationUnavailableError";
  }
}

function normalizeEndpoint(value: string, allowedHosts: readonly string[]): string {
  const parsedAllowedHosts = new Set(
    z.array(hostnameSchema).min(1).max(16).parse(allowedHosts),
  );
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Shared coordination URL must be valid.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "") ||
    !parsedAllowedHosts.has(url.hostname.toLowerCase())
  ) {
    throw new Error("Shared coordination URL must use an exactly allowed HTTPS origin.");
  }
  return url.origin;
}
