import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";

import {
  publicAuditEventSchema,
  type PublicAuditEvent,
  type PublicAuditRecordInput,
  type PublicAuditRecorder,
} from "./public-audit-ledger.js";
import {
  RedisRestCoordinationClient,
  SharedCoordinationUnavailableError,
} from "./redis-rest-coordination-client.js";
import {
  securityTelemetryEventSchema,
  type SecurityTelemetryEvent,
  type SecurityTelemetryRecordInput,
  type SecurityTelemetryRecorder,
} from "../security/security-telemetry.js";

const RECORD_EVENT_SCRIPT = `
local now = tonumber(ARGV[1])
local cutoff = tonumber(ARGV[2])
local maximum_entries = tonumber(ARGV[3])
local retention_ms = tonumber(ARGV[4])
local event_json = ARGV[5]
local operation = ARGV[6]
local outcome = ARGV[7]
local method = ARGV[8]
local status_class = ARGV[9]
local duration_ms = tonumber(ARGV[10])

redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', cutoff - 1)
redis.call('ZADD', KEYS[1], now, event_json)
local count = redis.call('ZCARD', KEYS[1])
if count > maximum_entries then
  redis.call('ZREMRANGEBYRANK', KEYS[1], 0, count - maximum_entries - 1)
end
redis.call('PEXPIRE', KEYS[1], retention_ms)

redis.call('HINCRBY', KEYS[2], 'total', 1)
redis.call('HINCRBY', KEYS[2], 'operation:' .. operation, 1)
redis.call('HINCRBY', KEYS[2], 'outcome:' .. outcome, 1)
redis.call('HINCRBY', KEYS[2], 'method:' .. method, 1)
redis.call('HINCRBY', KEYS[2], 'status:' .. status_class, 1)
redis.call('HINCRBY', KEYS[2], 'duration:count', 1)
redis.call('HINCRBY', KEYS[2], 'duration:sum_ms', duration_ms)
local current_max = tonumber(redis.call('HGET', KEYS[2], 'duration:max_ms') or '0')
if duration_ms > current_max then
  redis.call('HSET', KEYS[2], 'duration:max_ms', duration_ms)
end
redis.call('PEXPIRE', KEYS[2], retention_ms)
return redis.call('ZCARD', KEYS[1])
`.trim();

const RECORD_SECURITY_EVENT_SCRIPT = `
local now = tonumber(ARGV[1])
local cutoff = tonumber(ARGV[2])
local maximum_entries = tonumber(ARGV[3])
local retention_ms = tonumber(ARGV[4])
local event_json = ARGV[5]
local kind = ARGV[6]
local outcome = ARGV[7]
local surface = ARGV[8]
local capability = ARGV[9]

redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', cutoff - 1)
redis.call('ZADD', KEYS[1], now, event_json)
local count = redis.call('ZCARD', KEYS[1])
if count > maximum_entries then
  redis.call('ZREMRANGEBYRANK', KEYS[1], 0, count - maximum_entries - 1)
end
redis.call('PEXPIRE', KEYS[1], retention_ms)
redis.call('HINCRBY', KEYS[2], 'total', 1)
redis.call('HINCRBY', KEYS[2], 'kind:' .. kind, 1)
redis.call('HINCRBY', KEYS[2], 'outcome:' .. outcome, 1)
redis.call('HINCRBY', KEYS[2], 'surface:' .. surface, 1)
redis.call('HINCRBY', KEYS[2], 'capability:' .. capability, 1)
redis.call('PEXPIRE', KEYS[2], retention_ms)
return redis.call('ZCARD', KEYS[1])
`.trim();

interface SharedBoundedLedgerOptions {
  readonly client: RedisRestCoordinationClient;
  readonly maxEntries: number;
  readonly retentionMilliseconds: number;
  readonly now?: () => Date;
  readonly createId?: () => string;
}

export class SharedPublicAuditTelemetry implements PublicAuditRecorder {
  readonly scope = "shared" as const;
  readonly #client: RedisRestCoordinationClient;
  readonly #maxEntries: number;
  readonly #retentionMilliseconds: number;
  readonly #now: () => Date;
  readonly #createId: () => string;

  constructor(options: SharedBoundedLedgerOptions) {
    this.#client = options.client;
    this.#maxEntries = positiveInteger(options.maxEntries, 10_000);
    this.#retentionMilliseconds = positiveInteger(
      options.retentionMilliseconds,
      90 * 24 * 60 * 60 * 1_000,
    );
    this.#now = options.now ?? (() => new Date());
    this.#createId = options.createId ?? randomUUID;
  }

  async record(input: PublicAuditRecordInput): Promise<void> {
    const now = this.#now();
    const event = publicAuditEventSchema.parse({
      ...input,
      eventId: this.#createId(),
      occurredAt: now.toISOString(),
      durationMs: Math.max(0, Math.min(60_000, Math.round(input.durationMs))),
    });
    await this.#store(event, now);
  }

  async #store(event: PublicAuditEvent, now: Date): Promise<void> {
    const result = await this.#client.evaluate(
      RECORD_EVENT_SCRIPT,
      [
        this.#client.key("public-audit", "events"),
        this.#client.key("public-audit", "counters"),
      ],
      [
        now.getTime(),
        now.getTime() - this.#retentionMilliseconds,
        this.#maxEntries,
        this.#retentionMilliseconds,
        JSON.stringify(event),
        event.operation,
        event.outcome,
        event.method,
        statusClass(event.status),
        event.durationMs,
      ],
    );
    assertStoredCount(result, this.#maxEntries);
  }
}

export class SharedSecurityTelemetry implements SecurityTelemetryRecorder {
  readonly scope = "shared" as const;
  readonly #client: RedisRestCoordinationClient;
  readonly #maxEntries: number;
  readonly #retentionMilliseconds: number;
  readonly #now: () => Date;
  readonly #createId: () => string;

  constructor(options: SharedBoundedLedgerOptions) {
    this.#client = options.client;
    this.#maxEntries = positiveInteger(options.maxEntries, 10_000);
    this.#retentionMilliseconds = positiveInteger(
      options.retentionMilliseconds,
      90 * 24 * 60 * 60 * 1_000,
    );
    this.#now = options.now ?? (() => new Date());
    this.#createId = options.createId ?? randomUUID;
  }

  async record(input: SecurityTelemetryRecordInput): Promise<void> {
    const now = this.#now();
    const event = securityTelemetryEventSchema.parse({
      ...input,
      eventId: this.#createId(),
      occurredAt: now.toISOString(),
      durationMs: Math.max(0, Math.min(300_000, Math.round(input.durationMs))),
    });
    await this.#store(event, now);
  }

  async #store(event: SecurityTelemetryEvent, now: Date): Promise<void> {
    const result = await this.#client.evaluate(
      RECORD_SECURITY_EVENT_SCRIPT,
      [
        this.#client.key("security-events", "events"),
        this.#client.key("security-events", "counters"),
      ],
      [
        now.getTime(),
        now.getTime() - this.#retentionMilliseconds,
        this.#maxEntries,
        this.#retentionMilliseconds,
        JSON.stringify(event),
        event.kind,
        event.outcome,
        event.surface,
        event.capability,
      ],
    );
    assertStoredCount(result, this.#maxEntries);
  }
}

export const sharedObservabilityScriptFingerprints = Object.freeze({
  publicAuditTelemetry: createHash("sha256").update(RECORD_EVENT_SCRIPT).digest("hex"),
  securityTelemetry: createHash("sha256").update(RECORD_SECURITY_EVENT_SCRIPT).digest("hex"),
});

function positiveInteger(value: number, maximum: number): number {
  return z.number().int().min(1).max(maximum).parse(value);
}

function assertStoredCount(result: unknown, maximum: number): void {
  const parsed = z.number().int().min(0).max(maximum).safeParse(result);
  if (!parsed.success) throw new SharedCoordinationUnavailableError();
}

function statusClass(status: number): string {
  if (status < 200) return "informational";
  if (status < 300) return "successful";
  if (status < 400) return "redirection";
  if (status < 500) return "client-error";
  return "server-error";
}
