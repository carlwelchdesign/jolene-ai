import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

const publicAuditCountsSchema = z.object({
  evidenceCount: z.number().int().min(0).max(1_000_000).optional(),
  claimCount: z.number().int().min(0).max(100).optional(),
  citationCount: z.number().int().min(0).max(1_000).optional(),
  requirementCount: z.number().int().min(0).max(100).optional(),
  directCount: z.number().int().min(0).max(100).optional(),
  adjacentCount: z.number().int().min(0).max(100).optional(),
  unknownCount: z.number().int().min(0).max(100).optional(),
}).strict();

export const publicAuditEventSchema = z.object({
  eventId: z.string().uuid(),
  occurredAt: z.string().datetime({ offset: true }),
  operation: z.enum([
    "health",
    "manifest",
    "answer",
    "job_fit",
    "contact_intent",
    "unknown",
  ]),
  method: z.enum(["GET", "POST", "OTHER"]),
  status: z.number().int().min(100).max(599),
  outcome: z.enum([
    "ok",
    "supported",
    "model_supported",
    "model_fallback",
    "model_budget_fallback",
    "no_evidence",
    "compared",
    "accepted",
    "invalid_request",
    "invalid_json",
    "payload_too_large",
    "unsupported_media_type",
    "method_not_allowed",
    "not_found",
    "uri_too_long",
    "rate_limited",
    "busy",
    "disabled",
    "contact_queue_unavailable",
    "public_evidence_unavailable",
    "response_blocked",
    "request_aborted",
  ]),
  durationMs: z.number().int().min(0).max(60_000),
  corpusVersion: z.string().regex(/^career:[a-f0-9]{64}$/).optional(),
  counts: publicAuditCountsSchema.optional(),
}).strict();

export type PublicAuditEvent = z.infer<typeof publicAuditEventSchema>;
export type PublicAuditOperation = PublicAuditEvent["operation"];
export type PublicAuditMethod = PublicAuditEvent["method"];
export type PublicAuditOutcome = PublicAuditEvent["outcome"];
export type PublicAuditCounts = z.infer<typeof publicAuditCountsSchema>;

export const publicAuditLedgerSchema = z.object({
  schemaVersion: z.literal("jolene.public-audit.v1"),
  events: z.array(publicAuditEventSchema),
}).strict();

export interface PublicAuditRecordInput {
  readonly operation: PublicAuditOperation;
  readonly method: PublicAuditMethod;
  readonly status: number;
  readonly outcome: PublicAuditOutcome;
  readonly durationMs: number;
  readonly corpusVersion?: string;
  readonly counts?: PublicAuditCounts;
}

export interface PublicAuditRecorder {
  record(input: PublicAuditRecordInput): Promise<void>;
}

export interface FilePublicAuditLedgerOptions {
  readonly filePath: string;
  readonly maxEntries: number;
  readonly retentionMilliseconds: number;
  readonly now?: () => Date;
  readonly createId?: () => string;
}

export class FilePublicAuditLedger implements PublicAuditRecorder {
  readonly #filePath: string;
  readonly #maxEntries: number;
  readonly #retentionMilliseconds: number;
  readonly #now: () => Date;
  readonly #createId: () => string;
  #pendingWrite: Promise<void> = Promise.resolve();

  constructor(options: FilePublicAuditLedgerOptions) {
    if (!Number.isInteger(options.maxEntries) || options.maxEntries < 1) {
      throw new Error("Public audit max entries must be a positive integer.");
    }
    if (
      !Number.isInteger(options.retentionMilliseconds) ||
      options.retentionMilliseconds < 1
    ) {
      throw new Error("Public audit retention must be a positive integer.");
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
      const retained = this.#retained(loaded.events, this.#now())
        .slice(-this.#maxEntries);
      if (retained.length !== loaded.events.length) await this.#write(retained);
    } catch (error) {
      if (!isMissingFile(error)) throw error;
      await this.#write([]);
    }
  }

  record(input: PublicAuditRecordInput): Promise<void> {
    return this.#serialize(async () => {
      const now = this.#now();
      const event = publicAuditEventSchema.parse({
        ...input,
        eventId: this.#createId(),
        occurredAt: now.toISOString(),
        durationMs: Math.max(0, Math.min(60_000, Math.round(input.durationMs))),
      });
      const loaded = await this.#read();
      const retained = this.#retained(loaded.events, now);
      await this.#write([...retained, event].slice(-this.#maxEntries));
    });
  }

  list(): Promise<readonly PublicAuditEvent[]> {
    return this.#serialize(async () => {
      const loaded = await this.#read();
      const retained = this.#retained(loaded.events, this.#now())
        .slice(-this.#maxEntries);
      if (retained.length !== loaded.events.length) await this.#write(retained);
      return [...retained];
    });
  }

  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#pendingWrite.then(operation, operation);
    this.#pendingWrite = result.then(() => undefined, () => undefined);
    return result;
  }

  async #read(): Promise<z.infer<typeof publicAuditLedgerSchema>> {
    try {
      return publicAuditLedgerSchema.parse(
        JSON.parse(await readFile(this.#filePath, "utf8")),
      );
    } catch (error) {
      if (isMissingFile(error)) throw error;
      throw new PublicAuditUnavailableError();
    }
  }

  async #write(events: readonly PublicAuditEvent[]): Promise<void> {
    const body = `${JSON.stringify({
      schemaVersion: "jolene.public-audit.v1",
      events,
    }, null, 2)}\n`;
    const temporaryPath = `${this.#filePath}.${process.pid}.tmp`;
    try {
      await writeFile(temporaryPath, body, { encoding: "utf8", mode: 0o600 });
      await rename(temporaryPath, this.#filePath);
    } catch {
      throw new PublicAuditUnavailableError();
    }
  }

  #retained(
    events: readonly PublicAuditEvent[],
    now: Date,
  ): PublicAuditEvent[] {
    const cutoff = now.getTime() - this.#retentionMilliseconds;
    return events.filter((event) => Date.parse(event.occurredAt) >= cutoff);
  }
}

export class PublicAuditUnavailableError extends Error {
  constructor() {
    super("Public audit ledger is unavailable.");
    this.name = "PublicAuditUnavailableError";
  }
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
