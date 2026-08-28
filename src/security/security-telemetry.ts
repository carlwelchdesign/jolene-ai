import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

const opaqueIdentifierSchema = z.string().regex(/^[a-z][a-z0-9_]{1,31}:[a-f0-9]{32}$/);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const securityEventKindSchema = z.enum([
  "private_auth_denial",
  "tool_authorization",
  "disclosure_blocked",
  "provider_egress_blocked",
  "retrieval_suspicious",
  "grounding_failure",
  "rate_limit",
  "budget_limit",
  "content_quarantined",
  "safe_fallback",
  "hosted_admission",
]);

export const securitySurfaceSchema = z.enum([
  "private_api",
  "public_delegate",
  "private_retrieval",
  "tool_runtime",
  "slack",
  "embedding_pipeline",
  "external_ai_exchange",
  "contact_capture",
  "source_ingestion",
]);

export const securityOutcomeSchema = z.enum([
  "allowed",
  "denied",
  "blocked",
  "quarantined",
  "fallback",
  "failed_closed",
]);

export const securityReasonCodeSchema = z.enum([
  "actor_not_authorized",
  "credential_invalid",
  "capability_not_allowed",
  "approval_missing",
  "taint_policy_violation",
  "sensitive_disclosure_risk",
  "provider_boundary_violation",
  "retrieval_injection_detected",
  "retrieval_authority_missing",
  "grounding_unsupported",
  "grounding_conflicted",
  "request_rate_exceeded",
  "token_budget_exceeded",
  "content_policy_quarantine",
  "safe_fallback_selected",
  "origin_rejected",
  "service_disabled",
]);

const securityCountsSchema = z.object({
  inputItems: z.number().int().min(0).max(1_000_000).optional(),
  outputItems: z.number().int().min(0).max(1_000_000).optional(),
  retrievedItems: z.number().int().min(0).max(1_000_000).optional(),
  blockedItems: z.number().int().min(0).max(1_000_000).optional(),
  taintCount: z.number().int().min(0).max(10_000).optional(),
}).strict();

const securityVersionsSchema = z.object({
  policyHash: sha256Schema.optional(),
  corpusHash: sha256Schema.optional(),
  modelHash: sha256Schema.optional(),
  capabilityHash: sha256Schema.optional(),
}).strict();

export const securityTelemetryEventSchema = z.object({
  eventId: z.string().uuid(),
  occurredAt: z.string().datetime({ offset: true }),
  kind: securityEventKindSchema,
  surface: securitySurfaceSchema,
  outcome: securityOutcomeSchema,
  reasonCode: securityReasonCodeSchema,
  correlationId: opaqueIdentifierSchema,
  taintIds: z.array(opaqueIdentifierSchema).max(100),
  durationMs: z.number().int().min(0).max(300_000),
  counts: securityCountsSchema.optional(),
  versions: securityVersionsSchema.optional(),
}).strict();

export type SecurityTelemetryEvent = z.infer<typeof securityTelemetryEventSchema>;
export type SecurityTelemetryRecordInput = Omit<
  SecurityTelemetryEvent,
  "eventId" | "occurredAt"
>;

export const securityTelemetryLedgerSchema = z.object({
  schemaVersion: z.literal("jolene.security-telemetry.v1"),
  events: z.array(securityTelemetryEventSchema),
}).strict();

export interface SecurityTelemetryRecorder {
  record(input: SecurityTelemetryRecordInput): Promise<void>;
}

export interface FileSecurityTelemetryLedgerOptions {
  readonly filePath: string;
  readonly maxEntries: number;
  readonly retentionMilliseconds: number;
  readonly now?: () => Date;
  readonly createId?: () => string;
}

export class FileSecurityTelemetryLedger implements SecurityTelemetryRecorder {
  readonly #filePath: string;
  readonly #maxEntries: number;
  readonly #retentionMilliseconds: number;
  readonly #now: () => Date;
  readonly #createId: () => string;
  #pendingWrite: Promise<void> = Promise.resolve();

  constructor(options: FileSecurityTelemetryLedgerOptions) {
    if (!Number.isInteger(options.maxEntries) || options.maxEntries < 1) {
      throw new Error("Security telemetry max entries must be a positive integer.");
    }
    if (!Number.isInteger(options.retentionMilliseconds) || options.retentionMilliseconds < 1) {
      throw new Error("Security telemetry retention must be a positive integer.");
    }
    this.#filePath = options.filePath;
    this.#maxEntries = options.maxEntries;
    this.#retentionMilliseconds = options.retentionMilliseconds;
    this.#now = options.now ?? (() => new Date());
    this.#createId = options.createId ?? randomUUID;
  }

  async initialize(): Promise<void> {
    await mkdir(path.dirname(this.#filePath), { recursive: true, mode: 0o700 });
    try {
      const loaded = await this.#read();
      const retained = this.#retained(loaded.events, this.#now()).slice(-this.#maxEntries);
      if (retained.length !== loaded.events.length) await this.#write(retained);
    } catch (error) {
      if (!isMissingFile(error)) throw error;
      await this.#write([]);
    }
  }

  record(input: SecurityTelemetryRecordInput): Promise<void> {
    return this.#serialize(async () => {
      const now = this.#now();
      const event = securityTelemetryEventSchema.parse({
        ...input,
        eventId: this.#createId(),
        occurredAt: now.toISOString(),
        durationMs: Math.max(0, Math.min(300_000, Math.round(input.durationMs))),
      });
      const loaded = await this.#read();
      const retained = this.#retained(loaded.events, now);
      await this.#write([...retained, event].slice(-this.#maxEntries));
    });
  }

  list(): Promise<readonly SecurityTelemetryEvent[]> {
    return this.#serialize(async () => {
      const loaded = await this.#read();
      const retained = this.#retained(loaded.events, this.#now()).slice(-this.#maxEntries);
      if (retained.length !== loaded.events.length) await this.#write(retained);
      return [...retained];
    });
  }

  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#pendingWrite.then(operation, operation);
    this.#pendingWrite = result.then(() => undefined, () => undefined);
    return result;
  }

  async #read(): Promise<z.infer<typeof securityTelemetryLedgerSchema>> {
    try {
      return securityTelemetryLedgerSchema.parse(
        JSON.parse(await readFile(this.#filePath, "utf8")),
      );
    } catch (error) {
      if (isMissingFile(error)) throw error;
      throw new SecurityTelemetryUnavailableError();
    }
  }

  async #write(events: readonly SecurityTelemetryEvent[]): Promise<void> {
    const body = `${JSON.stringify({
      schemaVersion: "jolene.security-telemetry.v1",
      events,
    }, null, 2)}\n`;
    const temporaryPath = `${this.#filePath}.${process.pid}.tmp`;
    try {
      await writeFile(temporaryPath, body, { encoding: "utf8", mode: 0o600 });
      await rename(temporaryPath, this.#filePath);
    } catch {
      throw new SecurityTelemetryUnavailableError();
    }
  }

  #retained(events: readonly SecurityTelemetryEvent[], now: Date): SecurityTelemetryEvent[] {
    const cutoff = now.getTime() - this.#retentionMilliseconds;
    return events.filter((event) => Date.parse(event.occurredAt) >= cutoff);
  }
}

export class SecurityTelemetryUnavailableError extends Error {
  constructor() {
    super("Security telemetry ledger is unavailable.");
    this.name = "SecurityTelemetryUnavailableError";
  }
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
