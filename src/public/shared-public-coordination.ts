import { createHmac, randomUUID } from "node:crypto";

import { z } from "zod";

import type { PublicModelRequestBudget } from "./public-model-request-budget.js";
import type {
  PublicRequestAdmission,
  PublicRequestAdmissionController,
} from "./public-request-admission.js";
import {
  RedisRestCoordinationClient,
  SharedCoordinationUnavailableError,
} from "./redis-rest-coordination-client.js";

const admissionResultSchema = z.union([
  z.tuple([z.literal(1), z.string().uuid()]),
  z.tuple([z.literal(0), z.literal(429), z.number().int().min(1).max(86_400)]),
  z.tuple([z.literal(0), z.literal(503), z.number().int().min(1).max(300)]),
]);

const ADMISSION_SCRIPT = `
local now = tonumber(ARGV[1])
local window_ms = tonumber(ARGV[2])
local request_limit = tonumber(ARGV[3])
local concurrency_limit = tonumber(ARGV[4])
local lease_id = ARGV[5]
local lease_ms = tonumber(ARGV[6])

redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now)
local in_flight = redis.call('ZCARD', KEYS[2])
if in_flight >= concurrency_limit then
  return {0, 503, 1}
end

local window = redis.call('HMGET', KEYS[1], 'started_at', 'count')
local started_at = tonumber(window[1])
local count = tonumber(window[2])
if not started_at or not count or now - started_at >= window_ms then
  started_at = now
  count = 0
end
if count >= request_limit then
  local retry_seconds = math.max(1, math.ceil((window_ms - (now - started_at)) / 1000))
  return {0, 429, retry_seconds}
end

redis.call('HSET', KEYS[1], 'started_at', started_at, 'count', count + 1)
redis.call('PEXPIRE', KEYS[1], window_ms * 2)
redis.call('ZADD', KEYS[2], now + lease_ms, lease_id)
redis.call('PEXPIRE', KEYS[2], lease_ms * 2)
return {1, lease_id}
`.trim();

const RELEASE_SCRIPT = `
return redis.call('ZREM', KEYS[1], ARGV[1])
`.trim();

const MODEL_BUDGET_SCRIPT = `
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
local request_limit = tonumber(ARGV[1])
local window_ms = tonumber(ARGV[2])
if current >= request_limit then
  return 0
end
local next_count = redis.call('INCR', KEYS[1])
if next_count == 1 then
  redis.call('PEXPIRE', KEYS[1], window_ms)
end
return 1
`.trim();

export interface SharedPublicRequestAdmissionOptions {
  readonly client: RedisRestCoordinationClient;
  readonly clientHashKey: string;
  readonly requestsPerWindow: number;
  readonly maxConcurrentRequests: number;
  readonly windowMilliseconds?: number;
  readonly leaseMilliseconds?: number;
  readonly now?: () => number;
  readonly createLeaseId?: () => string;
}

export class SharedPublicRequestAdmission implements PublicRequestAdmissionController {
  readonly #client: RedisRestCoordinationClient;
  readonly #clientHashKey: string;
  readonly #requestsPerWindow: number;
  readonly #maxConcurrentRequests: number;
  readonly #windowMilliseconds: number;
  readonly #leaseMilliseconds: number;
  readonly #now: () => number;
  readonly #createLeaseId: () => string;

  constructor(options: SharedPublicRequestAdmissionOptions) {
    this.#client = options.client;
    this.#clientHashKey = z.string().min(32).max(4_096).parse(options.clientHashKey);
    this.#requestsPerWindow = z.number().int().min(1).max(10_000)
      .parse(options.requestsPerWindow);
    this.#maxConcurrentRequests = z.number().int().min(1).max(1_000)
      .parse(options.maxConcurrentRequests);
    this.#windowMilliseconds = z.number().int().min(1_000).max(86_400_000)
      .parse(options.windowMilliseconds ?? 60_000);
    this.#leaseMilliseconds = z.number().int().min(1_000).max(300_000)
      .parse(options.leaseMilliseconds ?? 15_000);
    this.#now = options.now ?? Date.now;
    this.#createLeaseId = options.createLeaseId ?? randomUUID;
  }

  async acquire(clientKey: string): Promise<PublicRequestAdmission> {
    const clientDigest = createHmac("sha256", this.#clientHashKey)
      .update(z.string().min(1).max(2_048).parse(clientKey))
      .digest("hex")
      .slice(0, 32);
    const leaseId = z.string().uuid().parse(this.#createLeaseId());
    let result: z.infer<typeof admissionResultSchema>;
    try {
      result = admissionResultSchema.parse(await this.#client.evaluate(
        ADMISSION_SCRIPT,
        [
          this.#client.key("admission", `client-${clientDigest}`),
          this.#client.key("admission", "leases"),
        ],
        [
          this.#now(),
          this.#windowMilliseconds,
          this.#requestsPerWindow,
          this.#maxConcurrentRequests,
          leaseId,
          this.#leaseMilliseconds,
        ],
      ));
    } catch {
      throw new SharedCoordinationUnavailableError();
    }
    if (result[0] === 0) {
      return result[1] === 429
        ? {
            accepted: false,
            status: 429,
            code: "rate_limited",
            retryAfterSeconds: result[2],
          }
        : {
            accepted: false,
            status: 503,
            code: "public_delegate_busy",
            retryAfterSeconds: result[2],
          };
    }
    let released = false;
    return {
      accepted: true,
      release: async () => {
        if (released) return;
        released = true;
        try {
          await this.#client.evaluate(
            RELEASE_SCRIPT,
            [this.#client.key("admission", "leases")],
            [leaseId],
          );
        } catch {
          // The lease expires automatically. Nothing content-bearing is
          // available here to log or return.
        }
      },
    };
  }
}

export interface SharedPublicModelRequestBudgetOptions {
  readonly client: RedisRestCoordinationClient;
  readonly maxRequestsPerWindow: number;
  readonly windowMilliseconds: number;
}

export class SharedPublicModelRequestBudget implements PublicModelRequestBudget {
  readonly #client: RedisRestCoordinationClient;
  readonly #maxRequestsPerWindow: number;
  readonly #windowMilliseconds: number;

  constructor(options: SharedPublicModelRequestBudgetOptions) {
    this.#client = options.client;
    this.#maxRequestsPerWindow = z.number().int().min(1).max(1_000_000)
      .parse(options.maxRequestsPerWindow);
    this.#windowMilliseconds = z.number().int().min(1_000).max(31_536_000_000)
      .parse(options.windowMilliseconds);
  }

  async reserve(): Promise<boolean> {
    const result = await this.#client.evaluate(
      MODEL_BUDGET_SCRIPT,
      [this.#client.key("model-budget", "requests")],
      [this.#maxRequestsPerWindow, this.#windowMilliseconds],
    );
    if (result === 1) return true;
    if (result === 0) return false;
    throw new SharedCoordinationUnavailableError();
  }
}

export const sharedPublicCoordinationScriptFingerprints = Object.freeze({
  admission: fingerprint(ADMISSION_SCRIPT),
  release: fingerprint(RELEASE_SCRIPT),
  modelBudget: fingerprint(MODEL_BUDGET_SCRIPT),
});

function fingerprint(script: string): string {
  return createHmac("sha256", "jolene-shared-coordination-script-v1")
    .update(script)
    .digest("hex");
}
