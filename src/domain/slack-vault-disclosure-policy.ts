import { z } from "zod";

export const SLACK_VAULT_DISCLOSURE_POLICY_VERSION =
  "jolene.slack-vault-disclosure.v1" as const;
export const SLACK_VAULT_DISCLOSURE_MAX_DURATION_MS = 15 * 60 * 1_000;

const stableIdSchema = z.string().trim().regex(/^[a-z][a-z0-9._:-]{2,159}$/u);
const slackChannelIdSchema = z.string().trim().regex(/^[CG][A-Z0-9]+$/u);
const slackUserIdSchema = z.string().trim().regex(/^[UW][A-Z0-9]+$/u);
const slackThreadTimestampSchema = z.string().trim().regex(/^\d{10,}\.\d{6}$/u);
const fingerprintSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const isoTimestampSchema = z.string().datetime({ offset: true });

export const slackVaultSourceReferenceSchema = z.object({
  notePath: z.string().trim().min(1).max(500).superRefine((value, context) => {
    const segments = value.split("/");
    if (
      value.startsWith("/") ||
      value.includes("\\") ||
      value.includes("*") ||
      value.includes("?") ||
      segments.some((segment) => segment === "" || segment === "." || segment === "..")
    ) {
      context.addIssue({
        code: "custom",
        message: "Vault note paths must be exact relative paths without traversal or wildcards.",
      });
    }
  }),
  heading: z.string().trim().min(1).max(240).refine(
    (value) => !value.includes("*") && !value.includes("?"),
    "Vault headings must be exact and cannot contain wildcards.",
  ),
}).strict();

export const slackVaultDisclosureGrantSchema = z.object({
  version: z.literal(SLACK_VAULT_DISCLOSURE_POLICY_VERSION),
  grantId: stableIdSchema,
  approvedByActorId: stableIdSchema,
  approvalAuthority: z.object({
    source: z.literal("authenticated_owner_review_ui"),
    authority: z.literal("user"),
    taintIds: z.array(z.never()).length(0),
    derivationIds: z.array(z.never()).length(0),
  }).strict(),
  workspaceId: stableIdSchema,
  channelKind: z.enum(["slack_private", "slack_shared"]),
  channelId: slackChannelIdSchema,
  threadTs: slackThreadTimestampSchema,
  recipientUserIds: z.array(slackUserIdSchema).min(1).max(100),
  purpose: z.string().trim().min(1).max(500),
  sourceReferences: z.array(slackVaultSourceReferenceSchema).min(1).max(24),
  contentFingerprint: fingerprintSchema,
  issuedAt: isoTimestampSchema,
  expiresAt: isoTimestampSchema,
}).strict().superRefine((grant, context) => {
  addDuplicateIssue(
    grant.recipientUserIds,
    ["recipientUserIds"],
    "Slack disclosure recipients must be unique.",
    context,
  );
  addDuplicateIssue(
    grant.sourceReferences.map(sourceReferenceKey),
    ["sourceReferences"],
    "Slack disclosure source references must be unique.",
    context,
  );
  const duration = Date.parse(grant.expiresAt) - Date.parse(grant.issuedAt);
  if (duration <= 0 || duration > SLACK_VAULT_DISCLOSURE_MAX_DURATION_MS) {
    context.addIssue({
      code: "custom",
      path: ["expiresAt"],
      message: "Slack vault disclosure grants must expire within fifteen minutes of issuance.",
    });
  }
});

export type SlackVaultSourceReference = z.infer<
  typeof slackVaultSourceReferenceSchema
>;
export type SlackVaultDisclosureGrant = z.infer<
  typeof slackVaultDisclosureGrantSchema
>;

export const SLACK_VAULT_DISCLOSURE_DENIAL_REASONS = Object.freeze([
  "owner_approval_mismatch",
  "not_yet_active",
  "expired",
  "workspace_mismatch",
  "channel_kind_mismatch",
  "channel_mismatch",
  "thread_mismatch",
  "recipient_mismatch",
  "source_mismatch",
  "content_mismatch",
] as const);

export type SlackVaultDisclosureDenialReason =
  (typeof SLACK_VAULT_DISCLOSURE_DENIAL_REASONS)[number];

export const slackVaultDisclosureAuthorizationInputSchema = z.object({
  grant: slackVaultDisclosureGrantSchema,
  ownerActorId: stableIdSchema,
  workspaceId: stableIdSchema,
  channelKind: z.enum(["slack_private", "slack_shared"]),
  channelId: slackChannelIdSchema,
  threadTs: slackThreadTimestampSchema,
  recipientUserIds: z.array(slackUserIdSchema).min(1).max(100),
  sourceReferences: z.array(slackVaultSourceReferenceSchema).min(1).max(24),
  contentFingerprint: fingerprintSchema,
  evaluatedAt: isoTimestampSchema,
}).strict().superRefine((request, context) => {
  addDuplicateIssue(
    request.recipientUserIds,
    ["recipientUserIds"],
    "Slack disclosure recipients must be unique.",
    context,
  );
  addDuplicateIssue(
    request.sourceReferences.map(sourceReferenceKey),
    ["sourceReferences"],
    "Slack disclosure source references must be unique.",
    context,
  );
});

export type SlackVaultDisclosureAuthorizationInput = z.infer<
  typeof slackVaultDisclosureAuthorizationInputSchema
>;

export interface SlackVaultDisclosureDecision {
  readonly policyVersion: typeof SLACK_VAULT_DISCLOSURE_POLICY_VERSION;
  readonly grantId: string;
  readonly outcome: "allow_once" | "deny";
  readonly reasonCodes: readonly SlackVaultDisclosureDenialReason[];
  readonly expiresAt: string;
}

export function authorizeSlackVaultDisclosure(
  input: SlackVaultDisclosureAuthorizationInput,
): SlackVaultDisclosureDecision {
  const request = slackVaultDisclosureAuthorizationInputSchema.parse(input);
  const grant = request.grant;
  const reasons = new Set<SlackVaultDisclosureDenialReason>();

  if (grant.approvedByActorId !== request.ownerActorId) {
    reasons.add("owner_approval_mismatch");
  }
  if (Date.parse(request.evaluatedAt) < Date.parse(grant.issuedAt)) {
    reasons.add("not_yet_active");
  }
  if (Date.parse(request.evaluatedAt) >= Date.parse(grant.expiresAt)) {
    reasons.add("expired");
  }
  if (grant.workspaceId !== request.workspaceId) reasons.add("workspace_mismatch");
  if (grant.channelKind !== request.channelKind) reasons.add("channel_kind_mismatch");
  if (grant.channelId !== request.channelId) reasons.add("channel_mismatch");
  if (grant.threadTs !== request.threadTs) reasons.add("thread_mismatch");
  if (!sameStringSet(grant.recipientUserIds, request.recipientUserIds)) {
    reasons.add("recipient_mismatch");
  }
  if (!sameStringSet(
    grant.sourceReferences.map(sourceReferenceKey),
    request.sourceReferences.map(sourceReferenceKey),
  )) {
    reasons.add("source_mismatch");
  }
  if (grant.contentFingerprint !== request.contentFingerprint) {
    reasons.add("content_mismatch");
  }

  return Object.freeze({
    policyVersion: SLACK_VAULT_DISCLOSURE_POLICY_VERSION,
    grantId: grant.grantId,
    outcome: reasons.size === 0 ? "allow_once" : "deny",
    reasonCodes: Object.freeze([...reasons].sort()),
    expiresAt: grant.expiresAt,
  });
}

function sourceReferenceKey(reference: SlackVaultSourceReference): string {
  return JSON.stringify([reference.notePath, reference.heading]);
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const leftSet = new Set(left);
  return leftSet.size === left.length &&
    right.every((value) => leftSet.has(value));
}

function addDuplicateIssue(
  values: readonly string[],
  path: readonly (string | number)[],
  message: string,
  context: z.RefinementCtx,
): void {
  if (new Set(values).size !== values.length) {
    context.addIssue({ code: "custom", path: [...path], message });
  }
}
