import { z } from "zod";

import {
  parseUntrustedContentEnvelope,
  untrustedContentClassificationSchema,
  untrustedContentOriginKindSchema,
  type UntrustedContentEnvelope,
} from "./untrusted-content.js";

export const PRIVATE_RAG_POLICY_VERSION = "jolene.private-rag-policy.v1" as const;

const identifierSchema = z.string().trim().min(1).max(512);
const fingerprintSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);

export const privateRagNamespaceSchema = z.enum([
  "obsidian.career",
  "obsidian.projects",
  "obsidian.engineering",
  "obsidian.personal",
  "obsidian.sources",
  "obsidian.other",
  "career_evidence",
  "durable_memory",
  "conversation_history",
  "task_context",
  "project_snapshot",
  "tool_result",
  "external_ai",
]);
export type PrivateRagNamespace = z.infer<typeof privateRagNamespaceSchema>;

export const privateRagRiskSignalSchema = z.enum([
  "instruction_like",
  "policy_or_authority_claim",
  "cross_source_directive",
  "alternate_encoding",
  "credential_like",
  "private_locator",
  "disallowed_contact_data",
  "provider_payload_drift",
]);
export type PrivateRagRiskSignal = z.infer<typeof privateRagRiskSignalSchema>;

export const privateRagReasonCodeSchema = z.enum([
  "allowed_local",
  "allowed_provider",
  "scope_mismatch",
  "namespace_not_allowed",
  "origin_not_allowed",
  "classification_not_allowed",
  "disclosure_exceeded",
  "content_revoked",
  "content_stale",
  "risk_quarantined",
  "provider_not_authorized",
  "provider_payload_class_not_allowed",
  "query_budget_exceeded",
  "result_budget_exceeded",
]);
export type PrivateRagReasonCode = z.infer<typeof privateRagReasonCodeSchema>;

export const privateRagTurnPolicySchema = z.object({
  version: z.literal(PRIVATE_RAG_POLICY_VERSION),
  eventId: identifierSchema,
  principal: z.object({
    actorId: identifierSchema,
    workspaceId: identifierSchema,
    verification: z.literal("authenticated_owner"),
  }).strict(),
  channel: z.object({
    kind: identifierSchema,
    id: identifierSchema,
    threadId: identifierSchema,
    disclosureCeiling: z.literal("owner_only"),
  }).strict(),
  currentIntentFingerprint: fingerprintSchema,
  allowedNamespaces: z.array(privateRagNamespaceSchema).min(1),
  allowedOrigins: z.array(untrustedContentOriginKindSchema).min(1),
  allowedClassifications: z.array(untrustedContentClassificationSchema).min(1),
  budgets: z.object({
    maxQueryTerms: z.number().int().positive().max(200),
    maxResultItems: z.number().int().positive().max(100),
    maxResultCharacters: z.number().int().positive().max(200_000),
  }).strict(),
  providerEgress: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("local_only") }).strict(),
    z.object({
      mode: z.literal("approved_provider"),
      providerId: identifierSchema,
      allowedPayloadClasses: z.array(z.enum([
        "query_terms",
        "reviewed_excerpt",
        "reviewed_career_claim",
      ])).min(1),
    }).strict(),
  ]),
}).strict().superRefine((policy, context) => {
  for (const [key, values] of [
    ["allowedNamespaces", policy.allowedNamespaces],
    ["allowedOrigins", policy.allowedOrigins],
    ["allowedClassifications", policy.allowedClassifications],
  ] as const) {
    if (new Set(values).size !== values.length) {
      context.addIssue({ code: "custom", path: [key], message: `${key} must be unique.` });
    }
  }
});

export type PrivateRagTurnPolicy = Readonly<z.infer<
  typeof privateRagTurnPolicySchema
>>;

export interface PrivateRagIngressInput {
  readonly namespace: PrivateRagNamespace;
  readonly envelope: UntrustedContentEnvelope;
  readonly riskSignals: readonly PrivateRagRiskSignal[];
  readonly queryTermCount: number;
  readonly resultItemCount: number;
  readonly resultCharacterCount: number;
  readonly providerPayloadClass?:
    | "query_terms"
    | "reviewed_excerpt"
    | "reviewed_career_claim";
}

export interface PrivateRagIngressDecision {
  readonly localUse: "allow" | "deny" | "quarantine";
  readonly providerEgress: "allow" | "deny";
  readonly reasonCodes: readonly PrivateRagReasonCode[];
  readonly authority: "none";
  readonly taintIds: readonly string[];
  readonly parentFingerprint: string;
}

export function evaluatePrivateRagIngress(
  policyInput: PrivateRagTurnPolicy,
  input: PrivateRagIngressInput,
): PrivateRagIngressDecision {
  const policy = privateRagTurnPolicySchema.parse(policyInput);
  const envelope = parseUntrustedContentEnvelope(input.envelope);
  const reasons = new Set<PrivateRagReasonCode>();
  assertBoundedCount(input.queryTermCount, "query term count");
  assertBoundedCount(input.resultItemCount, "result item count");
  assertBoundedCount(input.resultCharacterCount, "result character count");

  if (
    envelope.scope.actorId !== policy.principal.actorId ||
    envelope.scope.workspaceId !== policy.principal.workspaceId ||
    envelope.scope.channelKind !== policy.channel.kind ||
    envelope.scope.channelId !== policy.channel.id ||
    envelope.scope.threadId !== policy.channel.threadId
  ) reasons.add("scope_mismatch");
  if (!policy.allowedNamespaces.includes(input.namespace)) {
    reasons.add("namespace_not_allowed");
  }
  if (!policy.allowedOrigins.includes(envelope.origin.kind)) {
    reasons.add("origin_not_allowed");
  }
  if (!policy.allowedClassifications.includes(envelope.classification)) {
    reasons.add("classification_not_allowed");
  }
  if (envelope.disclosureCeiling !== "owner_only") {
    reasons.add("disclosure_exceeded");
  }
  if (envelope.revocation.status === "revoked") reasons.add("content_revoked");
  if (envelope.freshness.status === "stale") reasons.add("content_stale");
  if (input.queryTermCount > policy.budgets.maxQueryTerms) {
    reasons.add("query_budget_exceeded");
  }
  if (
    input.resultItemCount > policy.budgets.maxResultItems ||
    input.resultCharacterCount > policy.budgets.maxResultCharacters
  ) reasons.add("result_budget_exceeded");

  const riskSignals = privateRagRiskSignalSchema.array().parse(input.riskSignals);
  if (riskSignals.length > 0) reasons.add("risk_quarantined");
  const localUse = reasons.has("risk_quarantined")
    ? "quarantine" as const
    : reasons.size > 0
      ? "deny" as const
      : "allow" as const;

  if (localUse === "allow") {
    reasons.add("allowed_local");
  }
  if (policy.providerEgress.mode === "local_only") {
    reasons.add("provider_not_authorized");
  } else if (
    !input.providerPayloadClass ||
    !policy.providerEgress.allowedPayloadClasses.includes(
      input.providerPayloadClass,
    )
  ) {
    reasons.add("provider_payload_class_not_allowed");
  } else if (localUse === "allow") {
    reasons.add("allowed_provider");
  }
  const providerEgress = reasons.has("allowed_provider") && localUse === "allow"
    ? "allow" as const
    : "deny" as const;

  return Object.freeze({
    localUse,
    providerEgress,
    reasonCodes: Object.freeze([...reasons].sort()),
    authority: "none" as const,
    taintIds: Object.freeze([...envelope.lineage.taintIds]),
    parentFingerprint: envelope.provenanceFingerprint,
  });
}

export const privateRagDerivationSchema = z.object({
  id: identifierSchema,
  actorId: identifierSchema,
  workspaceId: identifierSchema,
  destination: z.enum(["index", "summary", "cache", "packet", "model_copy"]),
  parentFingerprints: z.array(fingerprintSchema).min(1).max(128),
  taintIds: z.array(identifierSchema).min(1).max(128),
  status: z.enum(["active", "invalidated"]),
  invalidationReason: z.enum([
    "parent_revoked",
    "parent_quarantined",
    "turn_reset",
    "policy_changed",
  ]).nullable(),
  createdAt: z.string().datetime({ offset: true }),
  invalidatedAt: z.string().datetime({ offset: true }).nullable(),
}).strict().superRefine((record, context) => {
  if (new Set(record.parentFingerprints).size !== record.parentFingerprints.length) {
    context.addIssue({
      code: "custom",
      path: ["parentFingerprints"],
      message: "Parent fingerprints must be unique.",
    });
  }
  if (new Set(record.taintIds).size !== record.taintIds.length) {
    context.addIssue({
      code: "custom",
      path: ["taintIds"],
      message: "Taint IDs must be unique.",
    });
  }
  const valid = record.status === "active"
    ? record.invalidationReason === null && record.invalidatedAt === null
    : record.invalidationReason !== null && record.invalidatedAt !== null;
  if (!valid) {
    context.addIssue({
      code: "custom",
      path: ["status"],
      message: "Derivation invalidation metadata does not match status.",
    });
  }
});

export type PrivateRagDerivation = Readonly<z.infer<
  typeof privateRagDerivationSchema
>>;

function assertBoundedCount(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`Private RAG ${label} is invalid.`);
  }
}
