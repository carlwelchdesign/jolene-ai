import { z } from "zod";

import {
  type PublicAuditMethod,
  type PublicAuditOperation,
  type PublicAuditOutcome,
  publicAuditEventSchema,
} from "./public-audit-ledger.js";

const operations = publicAuditEventSchema.shape.operation.options;
const outcomes = publicAuditEventSchema.shape.outcome.options;
const methods = publicAuditEventSchema.shape.method.options;
const latencyBounds = [10, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000, 30_000] as const;

type StatusClass = "informational" | "successful" | "redirection" |
  "clientError" | "serverError";

const fixedCountsSchema = <T extends string>(values: readonly T[]) =>
  z.object(Object.fromEntries(values.map((value) => [
    value,
    z.number().int().min(0),
  ])) as Record<T, z.ZodNumber>).strict();

export const publicOperationalSnapshotSchema = z.object({
  schemaVersion: z.literal("jolene.public-operations.v1"),
  startedAt: z.string().datetime({ offset: true }),
  observedAt: z.string().datetime({ offset: true }),
  totalRequests: z.number().int().min(0),
  inFlight: z.number().int().min(0),
  highWaterInFlight: z.number().int().min(0),
  statusClasses: z.object({
    informational: z.number().int().min(0),
    successful: z.number().int().min(0),
    redirection: z.number().int().min(0),
    clientError: z.number().int().min(0),
    serverError: z.number().int().min(0),
  }).strict(),
  operations: fixedCountsSchema(operations),
  methods: fixedCountsSchema(methods),
  outcomes: fixedCountsSchema(outcomes),
  latency: z.object({
    count: z.number().int().min(0),
    sumMs: z.number().int().min(0),
    maxMs: z.number().int().min(0).max(60_000),
    buckets: z.array(z.object({
      leMs: z.number().int().positive(),
      count: z.number().int().min(0),
    }).strict()).length(latencyBounds.length),
  }).strict(),
}).strict();

export type PublicOperationalSnapshot = z.infer<
  typeof publicOperationalSnapshotSchema
>;

export interface PublicOperationalMeasurement {
  complete(input: {
    readonly status: number;
    readonly outcome: PublicAuditOutcome;
  }): void;
}

export interface PublicOperationalTelemetry {
  begin(input: {
    readonly operation: PublicAuditOperation;
    readonly method: PublicAuditMethod;
  }): PublicOperationalMeasurement;
  snapshot(): PublicOperationalSnapshot;
}

export class InMemoryPublicOperationalTelemetry
  implements PublicOperationalTelemetry {
  readonly #startedAt: Date;
  readonly #now: () => Date;
  readonly #operations = zeroCounts(operations);
  readonly #methods = zeroCounts(methods);
  readonly #outcomes = zeroCounts(outcomes);
  readonly #statusClasses = {
    informational: 0,
    successful: 0,
    redirection: 0,
    clientError: 0,
    serverError: 0,
  };
  readonly #latencyBuckets = latencyBounds.map((leMs) => ({ leMs, count: 0 }));
  #totalRequests = 0;
  #inFlight = 0;
  #highWaterInFlight = 0;
  #latencyCount = 0;
  #latencySumMs = 0;
  #latencyMaxMs = 0;

  constructor(options: { readonly now?: () => Date } = {}) {
    this.#now = options.now ?? (() => new Date());
    this.#startedAt = this.#now();
  }

  begin(input: {
    readonly operation: PublicAuditOperation;
    readonly method: PublicAuditMethod;
  }): PublicOperationalMeasurement {
    const startedAt = this.#now().getTime();
    this.#inFlight += 1;
    this.#highWaterInFlight = Math.max(this.#highWaterInFlight, this.#inFlight);
    let completed = false;
    return {
      complete: ({ status, outcome }) => {
        if (completed) return;
        completed = true;
        const durationMs = boundedDuration(this.#now().getTime() - startedAt);
        this.#inFlight = Math.max(0, this.#inFlight - 1);
        this.#totalRequests += 1;
        this.#operations[input.operation] += 1;
        this.#methods[input.method] += 1;
        this.#outcomes[outcome] += 1;
        this.#statusClasses[statusClass(status)] += 1;
        this.#latencyCount += 1;
        this.#latencySumMs += durationMs;
        this.#latencyMaxMs = Math.max(this.#latencyMaxMs, durationMs);
        for (const bucket of this.#latencyBuckets) {
          if (durationMs <= bucket.leMs) bucket.count += 1;
        }
      },
    };
  }

  snapshot(): PublicOperationalSnapshot {
    return publicOperationalSnapshotSchema.parse({
      schemaVersion: "jolene.public-operations.v1",
      startedAt: this.#startedAt.toISOString(),
      observedAt: this.#now().toISOString(),
      totalRequests: this.#totalRequests,
      inFlight: this.#inFlight,
      highWaterInFlight: this.#highWaterInFlight,
      statusClasses: { ...this.#statusClasses },
      operations: { ...this.#operations },
      methods: { ...this.#methods },
      outcomes: { ...this.#outcomes },
      latency: {
        count: this.#latencyCount,
        sumMs: this.#latencySumMs,
        maxMs: this.#latencyMaxMs,
        buckets: this.#latencyBuckets.map((bucket) => ({ ...bucket })),
      },
    });
  }
}

function zeroCounts<T extends string>(values: readonly T[]): Record<T, number> {
  return Object.fromEntries(values.map((value) => [value, 0])) as Record<T, number>;
}

function boundedDuration(value: number): number {
  return Math.max(0, Math.min(60_000, Math.round(value)));
}

function statusClass(status: number): StatusClass {
  if (status >= 100 && status <= 199) return "informational";
  if (status >= 200 && status <= 299) return "successful";
  if (status >= 300 && status <= 399) return "redirection";
  if (status >= 400 && status <= 499) return "clientError";
  return "serverError";
}
