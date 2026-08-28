import { createHash } from "node:crypto";

import { z } from "zod";

export const UNTRUSTED_CONTENT_SCHEMA_VERSION =
  "jolene.untrusted-content.v1" as const;

const isoTimestampSchema = z.string().datetime({ offset: true });
const stableIdentifierSchema = z.string().trim().min(1).max(512)
  .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value), {
    message: "Identifiers cannot contain control characters.",
  });
const fingerprintSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);

export const untrustedContentOriginKindSchema = z.enum([
  "obsidian_excerpt",
  "career_evidence",
  "durable_memory",
  "conversation_quotation",
  "task_event",
  "recommendation",
  "project_snapshot",
  "job_description",
  "contact_submission",
  "tool_result",
  "external_ai_text",
  "user_message",
]);

export const untrustedContentClassificationSchema = z.enum([
  "public",
  "internal",
  "private",
  "restricted",
  "sensitive",
]);

export const untrustedContentDisclosureCeilingSchema = z.enum([
  "public",
  "owner_only",
  "no_disclosure",
]);

export const untrustedContentPurposeSchema = z.enum([
  "answer_context",
  "retrieval_evidence",
  "conversation_continuity",
  "work_context",
  "job_fit_comparison",
  "contact_review",
  "tool_observation",
  "external_ai_exchange",
]);

const jsonPrimitiveSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  jsonPrimitiveSchema,
  z.array(jsonValueSchema),
  z.record(z.string(), jsonValueSchema),
]));

export const untrustedContentPayloadSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("text"),
    text: z.string().max(100_000),
  }).strict(),
  z.object({
    kind: z.literal("json"),
    value: jsonValueSchema,
  }).strict(),
]);

const envelopeBodySchema = z.object({
  schemaVersion: z.literal(UNTRUSTED_CONTENT_SCHEMA_VERSION),
  origin: z.object({
    kind: untrustedContentOriginKindSchema,
    sourceId: stableIdentifierSchema,
  }).strict(),
  authority: z.literal("none"),
  scope: z.object({
    actorId: stableIdentifierSchema.nullable(),
    workspaceId: stableIdentifierSchema.nullable(),
    channelKind: stableIdentifierSchema.nullable(),
    channelId: stableIdentifierSchema.nullable(),
    threadId: stableIdentifierSchema.nullable(),
  }).strict(),
  classification: untrustedContentClassificationSchema,
  purpose: untrustedContentPurposeSchema,
  disclosureCeiling: untrustedContentDisclosureCeilingSchema,
  review: z.object({
    status: z.enum(["unreviewed", "approved", "rejected"]),
    reviewedAt: isoTimestampSchema.nullable(),
  }).strict(),
  freshness: z.object({
    observedAt: isoTimestampSchema,
    expiresAt: isoTimestampSchema.nullable(),
    status: z.enum(["fresh", "stale", "unknown"]),
  }).strict(),
  revocation: z.object({
    status: z.enum(["active", "revoked"]),
    revokedAt: isoTimestampSchema.nullable(),
    reasonCode: stableIdentifierSchema.nullable(),
  }).strict(),
  lineage: z.object({
    taintIds: z.array(stableIdentifierSchema).min(1).max(128),
    derivationIds: z.array(fingerprintSchema).max(128),
  }).strict(),
  payload: untrustedContentPayloadSchema,
}).strict().superRefine((body, context) => {
  requireStableUnique(body.lineage.taintIds, context, ["lineage", "taintIds"]);
  requireStableUnique(
    body.lineage.derivationIds,
    context,
    ["lineage", "derivationIds"],
  );
  if ((body.review.status === "unreviewed") !== (body.review.reviewedAt === null)) {
    context.addIssue({
      code: "custom",
      path: ["review", "reviewedAt"],
      message: "Only reviewed content may have a review timestamp.",
    });
  }
  const validRevocationState = body.revocation.status === "active"
    ? body.revocation.revokedAt === null && body.revocation.reasonCode === null
    : body.revocation.revokedAt !== null && body.revocation.reasonCode !== null;
  if (!validRevocationState) {
    context.addIssue({
      code: "custom",
      path: ["revocation"],
      message: "Revocation timestamp and reason are required only for revoked content.",
    });
  }
});

export const untrustedContentEnvelopeSchema = z.object({
  ...envelopeBodySchema.shape,
  provenanceFingerprint: fingerprintSchema,
}).strict().superRefine((envelope, context) => {
  const { provenanceFingerprint: _fingerprint, ...candidateBody } = envelope;
  const body = envelopeBodySchema.safeParse(candidateBody);
  if (!body.success) {
    for (const issue of body.error.issues) {
      context.addIssue({
        code: "custom",
        path: issue.path,
        message: issue.message,
      });
    }
    return;
  }
  const expected = untrustedContentFingerprint(body.data);
  if (envelope.provenanceFingerprint !== expected) {
    context.addIssue({
      code: "custom",
      path: ["provenanceFingerprint"],
      message: "Provenance fingerprint does not match the envelope body.",
    });
  }
});

export type UntrustedContentOriginKind = z.infer<
  typeof untrustedContentOriginKindSchema
>;
export type UntrustedContentClassification = z.infer<
  typeof untrustedContentClassificationSchema
>;
export type UntrustedContentDisclosureCeiling = z.infer<
  typeof untrustedContentDisclosureCeilingSchema
>;
export type UntrustedContentPurpose = z.infer<
  typeof untrustedContentPurposeSchema
>;
export type UntrustedContentPayload = z.infer<
  typeof untrustedContentPayloadSchema
>;
export type UntrustedContentEnvelope = Readonly<z.infer<
  typeof untrustedContentEnvelopeSchema
>>;
type UntrustedContentEnvelopeBody = z.infer<typeof envelopeBodySchema>;

export interface CreateUntrustedContentEnvelopeInput {
  readonly origin: {
    readonly kind: UntrustedContentOriginKind;
    readonly sourceId: string;
  };
  readonly scope: UntrustedContentEnvelopeBody["scope"];
  readonly classification: UntrustedContentClassification;
  readonly purpose: UntrustedContentPurpose;
  readonly disclosureCeiling: UntrustedContentDisclosureCeiling;
  readonly review: UntrustedContentEnvelopeBody["review"];
  readonly freshness: UntrustedContentEnvelopeBody["freshness"];
  readonly revocation: UntrustedContentEnvelopeBody["revocation"];
  readonly payload: UntrustedContentPayload;
  readonly taintIds?: readonly string[];
  readonly derivationIds?: readonly string[];
}

export function createUntrustedContentEnvelope(
  input: CreateUntrustedContentEnvelopeInput,
): UntrustedContentEnvelope {
  const body = envelopeBodySchema.parse({
    schemaVersion: UNTRUSTED_CONTENT_SCHEMA_VERSION,
    origin: input.origin,
    authority: "none",
    scope: input.scope,
    classification: input.classification,
    purpose: input.purpose,
    disclosureCeiling: input.disclosureCeiling,
    review: input.review,
    freshness: input.freshness,
    revocation: input.revocation,
    lineage: {
      taintIds: stableUnique(input.taintIds ?? [
        `taint:${digest(`${input.origin.kind}:${input.origin.sourceId}`).slice(0, 32)}`,
      ]),
      derivationIds: stableUnique(input.derivationIds ?? []),
    },
    payload: input.payload,
  });
  return deepFreeze(untrustedContentEnvelopeSchema.parse({
    ...body,
    provenanceFingerprint: untrustedContentFingerprint(body),
  }));
}

export function parseUntrustedContentEnvelope(
  input: unknown,
): UntrustedContentEnvelope {
  return deepFreeze(untrustedContentEnvelopeSchema.parse(input));
}

export function deriveUntrustedContentEnvelope(input: {
  readonly origin: CreateUntrustedContentEnvelopeInput["origin"];
  readonly parents: readonly UntrustedContentEnvelope[];
  readonly scope: CreateUntrustedContentEnvelopeInput["scope"];
  readonly purpose: UntrustedContentPurpose;
  readonly payload: UntrustedContentPayload;
  readonly observedAt: string;
}): UntrustedContentEnvelope {
  if (input.parents.length === 0) {
    throw new Error("Derived untrusted content requires at least one parent envelope.");
  }
  const parents = input.parents.map(parseUntrustedContentEnvelope);
  const revoked = parents.filter((parent) => parent.revocation.status === "revoked");
  const reviewStatuses = new Set(parents.map((parent) => parent.review.status));
  return createUntrustedContentEnvelope({
    origin: input.origin,
    scope: input.scope,
    classification: mostRestrictiveClassification(parents),
    purpose: input.purpose,
    disclosureCeiling: mostRestrictiveDisclosure(parents),
    review: reviewStatuses.size === 1 && reviewStatuses.has("approved")
      ? {
          status: "approved",
          reviewedAt: latestTimestamp(parents.map((parent) => parent.review.reviewedAt)),
        }
      : { status: "unreviewed", reviewedAt: null },
    freshness: {
      observedAt: input.observedAt,
      expiresAt: earliestTimestamp(parents.map((parent) => parent.freshness.expiresAt)),
      status: parents.some((parent) => parent.freshness.status === "stale")
        ? "stale"
        : parents.every((parent) => parent.freshness.status === "fresh")
          ? "fresh"
          : "unknown",
    },
    revocation: revoked.length > 0
      ? {
          status: "revoked",
          revokedAt: latestTimestamp(revoked.map((parent) => parent.revocation.revokedAt)),
          reasonCode: "derived_from_revoked_content",
        }
      : { status: "active", revokedAt: null, reasonCode: null },
    payload: input.payload,
    taintIds: stableUnique(parents.flatMap((parent) => parent.lineage.taintIds)),
    derivationIds: stableUnique(parents.map((parent) =>
      parent.provenanceFingerprint
    )),
  });
}

export function serializeUntrustedContentEnvelope(
  envelope: UntrustedContentEnvelope,
): string {
  return canonicalJson(parseUntrustedContentEnvelope(envelope));
}

function untrustedContentFingerprint(body: UntrustedContentEnvelopeBody): string {
  return `sha256:${digest(canonicalJson(body))}`;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]));
  }
  return value;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function requireStableUnique(
  values: readonly string[],
  context: z.RefinementCtx,
  path: PropertyKey[],
): void {
  if (JSON.stringify(values) !== JSON.stringify(stableUnique(values))) {
    context.addIssue({
      code: "custom",
      path,
      message: "Lineage identifiers must be unique and use stable sorted order.",
    });
  }
}

function mostRestrictiveClassification(
  parents: readonly UntrustedContentEnvelope[],
): UntrustedContentClassification {
  const order: readonly UntrustedContentClassification[] = [
    "public", "internal", "private", "restricted", "sensitive",
  ];
  return parents.reduce<UntrustedContentClassification>((current, parent) =>
    order.indexOf(parent.classification) > order.indexOf(current)
      ? parent.classification
      : current, "public");
}

function mostRestrictiveDisclosure(
  parents: readonly UntrustedContentEnvelope[],
): UntrustedContentDisclosureCeiling {
  const order: readonly UntrustedContentDisclosureCeiling[] = [
    "public", "owner_only", "no_disclosure",
  ];
  return parents.reduce<UntrustedContentDisclosureCeiling>((current, parent) =>
    order.indexOf(parent.disclosureCeiling) > order.indexOf(current)
      ? parent.disclosureCeiling
      : current, "public");
}

function latestTimestamp(values: readonly (string | null)[]): string | null {
  return values.filter((value): value is string => value !== null).sort().at(-1) ??
    null;
}

function earliestTimestamp(values: readonly (string | null)[]): string | null {
  const present = values.filter((value): value is string => value !== null).sort();
  return present[0] ?? null;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}
