import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";

import {
  requireModelCapability,
  type CapabilityId,
} from "./capability-registry.js";
import { channelKindSchema, type ChannelKind } from "./conversation.js";

export const TOOL_CALL_AUTHORIZATION_VERSION =
  "jolene.tool-call-authorization.v1" as const;

const isoTimestampSchema = z.string().datetime({ offset: true });
const identifierSchema = z.string().trim().min(1).max(240);
const fingerprintSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);

export const toolAuthorizationPurposeSchema = z.enum([
  "retrieval_evidence",
  "work_status_review",
  "project_awareness",
]);
export type ToolAuthorizationPurpose = z.infer<
  typeof toolAuthorizationPurposeSchema
>;

export const toolAuthorizationNamespaceSchema = z.enum([
  "obsidian",
  "career_evidence",
  "work_status",
  "watched_projects",
]);
export type ToolAuthorizationNamespace = z.infer<
  typeof toolAuthorizationNamespaceSchema
>;

export const toolAuthorizationDenialReasonSchema = z.enum([
  "intent_missing",
  "intent_ambiguous",
  "intent_expired",
  "capability_not_intended",
  "scope_mismatch",
  "argument_invalid",
  "argument_broadened",
  "alternate_encoding",
  "call_budget_exhausted",
  "result_budget_exhausted",
  "permit_invalid",
  "permit_already_settled",
  "untrusted_authority_source",
]);
export type ToolAuthorizationDenialReason = z.infer<
  typeof toolAuthorizationDenialReasonSchema
>;

const capabilityGrantSchema = z.object({
  capabilityId: z.enum([
    "knowledge.search",
    "career_evidence.search",
    "work_status.review",
    "watched_projects.list",
    "watched_projects.review",
  ]),
  purpose: toolAuthorizationPurposeSchema,
  namespace: toolAuthorizationNamespaceSchema,
  dataClasses: z.array(z.enum([
    "general", "private", "restricted", "sensitive",
  ])).min(1),
  disclosureCeiling: z.enum(["local_private", "verified_owner_dm"]),
  riskTier: z.literal("read_private"),
  maxCalls: z.number().int().positive().max(4),
  maxResultItems: z.number().int().positive().max(100),
  maxResultCharacters: z.number().int().positive().max(200_000),
}).strict();

export const toolIntentAuthorizationSchema = z.object({
  version: z.literal(TOOL_CALL_AUTHORIZATION_VERSION),
  authorizationId: z.string().uuid(),
  eventId: identifierSchema,
  principal: z.object({
    actorId: identifierSchema,
    workspaceId: identifierSchema,
    verification: z.literal("authenticated_owner"),
  }).strict(),
  channel: z.object({
    kind: channelKindSchema,
    id: identifierSchema,
    threadId: identifierSchema,
    disclosureCeiling: z.enum(["local_private", "verified_owner_dm"]),
  }).strict(),
  currentIntent: z.object({
    source: z.literal("authenticated_current_user_turn"),
    authority: z.literal("user"),
    fingerprint: fingerprintSchema,
    terms: z.array(identifierSchema).min(1).max(200),
    taintIds: z.array(z.never()).length(0),
    derivationIds: z.array(z.never()).length(0),
    receivedAt: isoTimestampSchema,
    expiresAt: isoTimestampSchema,
  }).strict(),
  grants: z.array(capabilityGrantSchema).max(5),
  budget: z.object({
    maxCalls: z.number().int().positive().max(10),
    maxResultItems: z.number().int().positive().max(200),
    maxResultCharacters: z.number().int().positive().max(500_000),
  }).strict(),
}).strict().superRefine((authorization, context) => {
  if (Date.parse(authorization.currentIntent.expiresAt) <=
      Date.parse(authorization.currentIntent.receivedAt)) {
    context.addIssue({
      code: "custom",
      path: ["currentIntent", "expiresAt"],
      message: "Intent expiry must follow receipt time.",
    });
  }
  const capabilityIds = authorization.grants.map((grant) => grant.capabilityId);
  if (new Set(capabilityIds).size !== capabilityIds.length) {
    context.addIssue({ code: "custom", message: "Capability grants must be unique." });
  }
});

export type ToolIntentAuthorization = Readonly<z.infer<
  typeof toolIntentAuthorizationSchema
>>;
export type ToolCapabilityGrant = Readonly<z.infer<
  typeof capabilityGrantSchema
>>;

export interface CreateToolIntentAuthorizationInput {
  readonly eventId: string;
  readonly actorId: string;
  readonly workspaceId: string;
  readonly channelKind: ChannelKind;
  readonly channelId: string;
  readonly threadId: string;
  readonly disclosureCeiling: "local_private" | "verified_owner_dm";
  readonly currentMessage: string;
  readonly receivedAt: string;
  readonly expiresAt?: string;
  readonly availableCapabilityIds: readonly CapabilityId[];
  readonly intentSource?: {
    readonly source: "authenticated_current_user_turn";
    readonly authority: "user";
    readonly taintIds: readonly never[];
    readonly derivationIds: readonly never[];
  };
  readonly createId?: () => string;
}

export interface ToolCallAuthorizationPermit {
  readonly permitId: string;
  readonly authorizationId: string;
  readonly eventId: string;
  readonly capabilityId: ToolCapabilityGrant["capabilityId"];
  readonly purpose: ToolAuthorizationPurpose;
  readonly namespace: ToolAuthorizationNamespace;
  readonly disclosureCeiling: "local_private" | "verified_owner_dm";
  readonly riskTier: "read_private";
  readonly argumentsFingerprint: `sha256:${string}`;
  readonly authorizedAt: string;
  readonly expiresAt: string;
}

export interface ToolResultBudget {
  readonly itemCount: number;
  readonly characterCount: number;
}

export function createToolIntentAuthorization(
  input: CreateToolIntentAuthorizationInput,
): ToolIntentAuthorization {
  if (!validPrivateDisclosureScope(
    input.channelKind,
    input.disclosureCeiling,
  )) {
    throw new ToolCallAuthorizationDeniedError("scope_mismatch");
  }
  const terms = meaningfulTerms(input.currentMessage);
  if (terms.length === 0) {
    throw new ToolCallAuthorizationDeniedError("intent_missing");
  }
  const intentSource = input.intentSource ?? {
    source: "authenticated_current_user_turn" as const,
    authority: "user" as const,
    taintIds: [] as readonly never[],
    derivationIds: [] as readonly never[],
  };
  if (
    intentSource.source !== "authenticated_current_user_turn" ||
    intentSource.authority !== "user" ||
    intentSource.taintIds.length > 0 ||
    intentSource.derivationIds.length > 0
  ) {
    throw new ToolCallAuthorizationDeniedError("untrusted_authority_source");
  }
  const receivedAt = isoTimestampSchema.parse(input.receivedAt);
  const expiresAt = input.expiresAt ??
    new Date(Date.parse(receivedAt) + 2 * 60 * 1_000).toISOString();
  const grants = [...new Set(input.availableCapabilityIds)]
    .filter(isReadOnlyModelCapabilityId)
    .filter((capabilityId) => intentAllowsCapability(capabilityId, terms))
    .map((capabilityId) => grantFor(
      capabilityId,
      input.channelKind,
      input.disclosureCeiling,
    ));
  return deepFreeze(toolIntentAuthorizationSchema.parse({
    version: TOOL_CALL_AUTHORIZATION_VERSION,
    authorizationId: (input.createId ?? randomUUID)(),
    eventId: input.eventId,
    principal: {
      actorId: input.actorId,
      workspaceId: input.workspaceId,
      verification: "authenticated_owner",
    },
    channel: {
      kind: input.channelKind,
      id: input.channelId,
      threadId: input.threadId,
      disclosureCeiling: input.disclosureCeiling,
    },
    currentIntent: {
      ...intentSource,
      fingerprint: sha256(input.currentMessage),
      terms,
      receivedAt,
      expiresAt,
    },
    grants,
    budget: {
      maxCalls: Math.max(1, Math.min(3, grants.length)),
      maxResultItems: 32,
      maxResultCharacters: 120_000,
    },
  }));
}

export class IntentBoundToolAuthorizer {
  readonly #authorization: ToolIntentAuthorization;
  readonly #calls = new Map<ToolCapabilityGrant["capabilityId"], number>();
  readonly #permits = new Map<string, {
    readonly permit: ToolCallAuthorizationPermit;
    readonly grant: ToolCapabilityGrant;
    settled: boolean;
  }>();
  #totalCalls = 0;
  #totalResultItems = 0;
  #totalResultCharacters = 0;

  constructor(authorization: ToolIntentAuthorization) {
    this.#authorization = deepFreeze(toolIntentAuthorizationSchema.parse(
      authorization,
    ));
  }

  get authorization(): ToolIntentAuthorization {
    return this.#authorization;
  }

  authorize(
    capabilityId: CapabilityId,
    args: unknown,
    now: string,
  ): ToolCallAuthorizationPermit {
    const authorizedAt = isoTimestampSchema.parse(now);
    if (Date.parse(authorizedAt) >=
        Date.parse(this.#authorization.currentIntent.expiresAt)) {
      throw new ToolCallAuthorizationDeniedError("intent_expired");
    }
    const grant = this.#authorization.grants.find((candidate) =>
      candidate.capabilityId === capabilityId
    );
    if (!grant) {
      throw new ToolCallAuthorizationDeniedError(
        this.#authorization.grants.length === 0
          ? "intent_ambiguous"
          : "capability_not_intended",
      );
    }
    if (grant.disclosureCeiling !== this.#authorization.channel.disclosureCeiling) {
      throw new ToolCallAuthorizationDeniedError("scope_mismatch");
    }
    validateArguments(
      grant.capabilityId,
      args,
      this.#authorization.currentIntent.terms,
    );
    const capabilityCalls = this.#calls.get(grant.capabilityId) ?? 0;
    if (
      capabilityCalls >= grant.maxCalls ||
      this.#totalCalls >= this.#authorization.budget.maxCalls
    ) {
      throw new ToolCallAuthorizationDeniedError("call_budget_exhausted");
    }
    this.#calls.set(grant.capabilityId, capabilityCalls + 1);
    this.#totalCalls += 1;
    const permit: ToolCallAuthorizationPermit = Object.freeze({
      permitId: randomUUID(),
      authorizationId: this.#authorization.authorizationId,
      eventId: this.#authorization.eventId,
      capabilityId: grant.capabilityId,
      purpose: grant.purpose,
      namespace: grant.namespace,
      disclosureCeiling: grant.disclosureCeiling,
      riskTier: grant.riskTier,
      argumentsFingerprint: sha256(canonicalJson(args)),
      authorizedAt,
      expiresAt: this.#authorization.currentIntent.expiresAt,
    });
    this.#permits.set(permit.permitId, { permit, grant, settled: false });
    return permit;
  }

  recordResult(
    permit: ToolCallAuthorizationPermit,
    result: ToolResultBudget,
    now: string,
  ): void {
    const settledAt = isoTimestampSchema.parse(now);
    const state = this.#permits.get(permit.permitId);
    if (
      !state ||
      state.permit.authorizationId !== permit.authorizationId ||
      state.permit.argumentsFingerprint !== permit.argumentsFingerprint
    ) {
      throw new ToolCallAuthorizationDeniedError("permit_invalid");
    }
    if (state.settled) {
      throw new ToolCallAuthorizationDeniedError("permit_already_settled");
    }
    state.settled = true;
    if (Date.parse(settledAt) >= Date.parse(state.permit.expiresAt)) {
      throw new ToolCallAuthorizationDeniedError("intent_expired");
    }
    if (
      !Number.isInteger(result.itemCount) || result.itemCount < 0 ||
      !Number.isInteger(result.characterCount) || result.characterCount < 0 ||
      result.itemCount > state.grant.maxResultItems ||
      result.characterCount > state.grant.maxResultCharacters ||
      this.#totalResultItems + result.itemCount >
        this.#authorization.budget.maxResultItems ||
      this.#totalResultCharacters + result.characterCount >
        this.#authorization.budget.maxResultCharacters
    ) {
      throw new ToolCallAuthorizationDeniedError("result_budget_exhausted");
    }
    this.#totalResultItems += result.itemCount;
    this.#totalResultCharacters += result.characterCount;
  }
}

function validPrivateDisclosureScope(
  channelKind: ChannelKind,
  disclosureCeiling: "local_private" | "verified_owner_dm",
): boolean {
  if (channelKind === "cli" || channelKind === "private_chat") {
    return disclosureCeiling === "local_private";
  }
  if (channelKind === "slack_dm") {
    return disclosureCeiling === "verified_owner_dm";
  }
  return false;
}

export class ToolCallAuthorizationDeniedError extends Error {
  readonly code = "tool_call_not_authorized" as const;

  constructor(readonly reasonCode: ToolAuthorizationDenialReason) {
    super("The requested private capability was not authorized for this turn.");
    this.name = "ToolCallAuthorizationDeniedError";
  }
}

function grantFor(
  capabilityId: ToolCapabilityGrant["capabilityId"],
  channelKind: ChannelKind,
  disclosureCeiling: "local_private" | "verified_owner_dm",
): ToolCapabilityGrant {
  const capability = requireModelCapability(capabilityId, channelKind);
  const contract = CAPABILITY_AUTHORIZATION_CONTRACTS[capabilityId];
  return capabilityGrantSchema.parse({
    capabilityId,
    purpose: contract.purpose,
    namespace: contract.namespace,
    dataClasses: capability.dataClasses,
    disclosureCeiling,
    riskTier: capability.baseRisk,
    ...contract.budget,
  });
}

const CAPABILITY_AUTHORIZATION_CONTRACTS: Readonly<Record<
  ToolCapabilityGrant["capabilityId"],
  {
    readonly purpose: ToolAuthorizationPurpose;
    readonly namespace: ToolAuthorizationNamespace;
    readonly budget: Pick<
      ToolCapabilityGrant,
      "maxCalls" | "maxResultItems" | "maxResultCharacters"
    >;
  }
>> = {
  "knowledge.search": {
    purpose: "retrieval_evidence",
    namespace: "obsidian",
    budget: { maxCalls: 1, maxResultItems: 8, maxResultCharacters: 40_000 },
  },
  "career_evidence.search": {
    purpose: "retrieval_evidence",
    namespace: "career_evidence",
    budget: { maxCalls: 1, maxResultItems: 8, maxResultCharacters: 50_000 },
  },
  "work_status.review": {
    purpose: "work_status_review",
    namespace: "work_status",
    budget: { maxCalls: 1, maxResultItems: 20, maxResultCharacters: 60_000 },
  },
  "watched_projects.list": {
    purpose: "project_awareness",
    namespace: "watched_projects",
    budget: { maxCalls: 1, maxResultItems: 20, maxResultCharacters: 20_000 },
  },
  "watched_projects.review": {
    purpose: "project_awareness",
    namespace: "watched_projects",
    budget: { maxCalls: 1, maxResultItems: 1, maxResultCharacters: 20_000 },
  },
};

function intentAllowsCapability(
  capabilityId: ToolCapabilityGrant["capabilityId"],
  terms: readonly string[],
): boolean {
  return CAPABILITY_INTENT_TERMS[capabilityId].some((term) => terms.includes(term));
}

const CAPABILITY_INTENT_TERMS: Readonly<Record<
  ToolCapabilityGrant["capabilityId"],
  readonly string[]
>> = {
  "knowledge.search": [
    "knowledge", "note", "notes", "obsidian", "recipe", "recipes", "cooking",
    "favorite", "remember",
  ],
  "career_evidence.search": [
    "career", "experience", "hire", "hiring", "job", "professional",
    "qualification", "qualifications", "recommendation", "resume", "skills",
  ],
  "work_status.review": [
    "approval", "failed", "priority", "progress", "queue", "running", "status",
    "task", "tasks", "workflow", "workflows",
  ],
  "watched_projects.list": [
    "branch", "git", "plan", "project", "projects", "repo", "repository", "watched",
  ],
  "watched_projects.review": [
    "branch", "git", "plan", "project", "repo", "repository", "watched",
  ],
};

function validateArguments(
  capabilityId: ToolCapabilityGrant["capabilityId"],
  input: unknown,
  intentTerms: readonly string[],
): void {
  const args = argumentSchema(capabilityId).safeParse(input);
  if (!args.success) {
    throw new ToolCallAuthorizationDeniedError("argument_invalid");
  }
  const strings = collectStrings(args.data);
  if (strings.some(hasAlternateEncoding)) {
    throw new ToolCallAuthorizationDeniedError("alternate_encoding");
  }
  if (capabilityId === "knowledge.search" ||
      capabilityId === "career_evidence.search") {
    const query = (args.data as unknown as { readonly query: string }).query;
    requireTermsWithinIntent(query, intentTerms);
  }
  if (capabilityId === "watched_projects.review") {
    const projectId = (args.data as unknown as { readonly projectId: string })
      .projectId;
    requireTermsWithinIntent(projectId, intentTerms);
  }
  if (capabilityId === "work_status.review") {
    const statuses = (args.data as unknown as {
      readonly statuses: readonly string[] | null;
    })
      .statuses ?? [];
    for (const status of statuses) {
      if (!intentTerms.includes(normalizeTerm(status))) {
        throw new ToolCallAuthorizationDeniedError("argument_broadened");
      }
    }
  }
}

function argumentSchema(capabilityId: ToolCapabilityGrant["capabilityId"]) {
  switch (capabilityId) {
    case "knowledge.search":
      return z.object({
        query: z.string().trim().min(3).max(500),
        limit: z.number().int().min(1).max(8),
      }).strict();
    case "career_evidence.search":
      return z.object({
        query: z.string().trim().min(2).max(1_000),
        limit: z.number().int().min(1).max(8),
      }).strict();
    case "work_status.review":
      return z.object({
        statuses: z.array(z.enum([
          "pending", "running", "approval_needed", "failed", "retryable",
          "completed", "cancelled",
        ])).min(1).max(7).nullable(),
        limit: z.number().int().min(1).max(20),
      }).strict();
    case "watched_projects.list":
      return z.object({}).strict();
    case "watched_projects.review":
      return z.object({ projectId: z.string().trim().min(1).max(120) }).strict();
  }
}

function requireTermsWithinIntent(
  value: string,
  intentTerms: readonly string[],
): void {
  const terms = meaningfulTerms(value);
  if (terms.length === 0 || terms.some((term) => !intentTerms.includes(term))) {
    throw new ToolCallAuthorizationDeniedError("argument_broadened");
  }
}

function meaningfulTerms(value: string): string[] {
  return [...new Set(value.normalize("NFKC").toLocaleLowerCase("en-US")
    .split(/[^\p{L}\p{N}_-]+/u)
    .map(normalizeTerm)
    .filter((term) => term.length >= 2 && !INTENT_STOP_WORDS.has(term)))]
    .sort();
}

function normalizeTerm(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US");
}

const INTENT_STOP_WORDS = new Set([
  "a", "about", "an", "and", "are", "carl", "for", "from", "has", "have",
  "i", "in", "is", "me", "my", "of", "on", "please", "that", "the", "this",
  "to", "use", "what", "which", "with",
]);

function hasAlternateEncoding(value: string): boolean {
  return value !== value.normalize("NFKC") ||
    /%(?:[0-9a-f]{2})|&#(?:x[0-9a-f]+|\d+);|\\u[0-9a-f]{4}/iu.test(value) ||
    /(?:[A-Za-z0-9+/]{20,}={0,2})/u.test(value);
}

function collectStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  if (value && typeof value === "object") {
    return Object.values(value).flatMap(collectStrings);
  }
  return [];
}

function isReadOnlyModelCapabilityId(
  id: CapabilityId,
): id is ToolCapabilityGrant["capabilityId"] {
  return id !== "external_message.send";
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([left], [right]) =>
      left.localeCompare(right)
    ).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}
