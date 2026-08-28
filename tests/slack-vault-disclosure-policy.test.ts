import { describe, expect, it } from "vitest";

import {
  SLACK_VAULT_DISCLOSURE_POLICY_VERSION,
  authorizeSlackVaultDisclosure,
  slackVaultDisclosureGrantSchema,
  type SlackVaultDisclosureAuthorizationInput,
  type SlackVaultDisclosureDenialReason,
  type SlackVaultDisclosureGrant,
} from "../src/domain/slack-vault-disclosure-policy.js";

const fingerprint = `sha256:${"a".repeat(64)}`;
const sourceReferences = [{
  notePath: "06 Personal/Recipes and Cooking.md",
  heading: "Sunday gravy",
}];

function grant(
  overrides: Partial<SlackVaultDisclosureGrant> = {},
): SlackVaultDisclosureGrant {
  return {
    version: SLACK_VAULT_DISCLOSURE_POLICY_VERSION,
    grantId: "grant:slack-vault-001",
    approvedByActorId: "carl",
    approvalAuthority: {
      source: "authenticated_owner_review_ui",
      authority: "user",
      taintIds: [],
      derivationIds: [],
    },
    workspaceId: "personal",
    channelKind: "slack_shared",
    channelId: "C0BSJ8L1C3F",
    threadTs: "1787942400.123456",
    recipientUserIds: ["U0BSN6JA3PC", "U0RECIPIENT1"],
    purpose: "Share one approved recipe with the named participants.",
    sourceReferences,
    contentFingerprint: fingerprint,
    issuedAt: "2026-08-28T22:00:00.000Z",
    expiresAt: "2026-08-28T22:15:00.000Z",
    ...overrides,
  };
}

function request(
  overrides: Partial<SlackVaultDisclosureAuthorizationInput> = {},
): SlackVaultDisclosureAuthorizationInput {
  const exactGrant = grant();
  return {
    grant: exactGrant,
    ownerActorId: "carl",
    workspaceId: exactGrant.workspaceId,
    channelKind: exactGrant.channelKind,
    channelId: exactGrant.channelId,
    threadTs: exactGrant.threadTs,
    recipientUserIds: exactGrant.recipientUserIds,
    sourceReferences: exactGrant.sourceReferences,
    contentFingerprint: exactGrant.contentFingerprint,
    evaluatedAt: "2026-08-28T22:10:00.000Z",
    ...overrides,
  };
}

const mismatchCases: readonly [
  string,
  Partial<SlackVaultDisclosureAuthorizationInput>,
  SlackVaultDisclosureDenialReason,
][] = [
  ["owner approval", { ownerActorId: "someone-else" }, "owner_approval_mismatch"],
  ["workspace", { workspaceId: "other-workspace" }, "workspace_mismatch"],
  ["channel kind", { channelKind: "slack_private" }, "channel_kind_mismatch"],
  ["channel", { channelId: "COTHER" }, "channel_mismatch"],
  ["thread", { threadTs: "1787942401.123456" }, "thread_mismatch"],
  ["recipients", { recipientUserIds: ["U0BSN6JA3PC"] }, "recipient_mismatch"],
  ["sources", { sourceReferences: [{ notePath: "Private.md", heading: "Other" }] }, "source_mismatch"],
  ["content", { contentFingerprint: `sha256:${"b".repeat(64)}` }, "content_mismatch"],
  ["issue time", { evaluatedAt: "2026-08-28T21:59:59.000Z" }, "not_yet_active"],
  ["expiry", { evaluatedAt: "2026-08-28T22:15:00.000Z" }, "expired"],
];

describe("Slack vault disclosure policy", () => {
  it("allows one exact, current, owner-approved disclosure", () => {
    expect(authorizeSlackVaultDisclosure(request())).toEqual({
      policyVersion: SLACK_VAULT_DISCLOSURE_POLICY_VERSION,
      grantId: "grant:slack-vault-001",
      outcome: "allow_once",
      reasonCodes: [],
      expiresAt: "2026-08-28T22:15:00.000Z",
    });
  });

  it.each(mismatchCases)("denies a %s mismatch", (_label, overrides, reasonCode) => {
    const decision = authorizeSlackVaultDisclosure(request(overrides));

    expect(decision.outcome).toBe("deny");
    expect(decision.reasonCodes).toContain(reasonCode);
  });

  it("treats recipient and source order as immaterial but rejects duplicates", () => {
    expect(authorizeSlackVaultDisclosure(request({
      recipientUserIds: [...grant().recipientUserIds].reverse(),
    })).outcome).toBe("allow_once");
    expect(() => slackVaultDisclosureGrantSchema.parse(grant({
      recipientUserIds: ["U0BSN6JA3PC", "U0BSN6JA3PC"],
    }))).toThrow(/unique/u);
    expect(() => slackVaultDisclosureGrantSchema.parse(grant({
      sourceReferences: [...sourceReferences, ...sourceReferences],
    }))).toThrow(/unique/u);
    expect(() => authorizeSlackVaultDisclosure(request({
      recipientUserIds: ["U0BSN6JA3PC", "U0BSN6JA3PC"],
    }))).toThrow(/unique/u);
  });

  it("rejects broad paths, wildcard headings, and grants longer than fifteen minutes", () => {
    for (const notePath of ["/private.md", "../private.md", "folder/*", "folder\\note.md"]) {
      expect(() => slackVaultDisclosureGrantSchema.parse(grant({
        sourceReferences: [{ notePath, heading: "Exact heading" }],
      }))).toThrow(/exact relative paths/u);
    }
    expect(() => slackVaultDisclosureGrantSchema.parse(grant({
      sourceReferences: [{ notePath: "Private.md", heading: "Everything *" }],
    }))).toThrow(/cannot contain wildcards/u);
    expect(() => slackVaultDisclosureGrantSchema.parse(grant({
      expiresAt: "2026-08-28T22:15:00.001Z",
    }))).toThrow(/within fifteen minutes/u);
  });

  it("rejects model-derived or unauthenticated approval authority", () => {
    expect(() => slackVaultDisclosureGrantSchema.parse({
      ...grant(),
      approvalAuthority: {
        source: "model_output",
        authority: "assistant",
        taintIds: ["taint:prompt"],
        derivationIds: ["derivation:model"],
      },
    })).toThrow();
  });

  it("returns an audit-safe decision without content, purpose, recipients, or source paths", () => {
    const serialized = JSON.stringify(authorizeSlackVaultDisclosure(request()));

    expect(serialized).not.toContain("Sunday gravy");
    expect(serialized).not.toContain("Recipes and Cooking");
    expect(serialized).not.toContain("Share one approved recipe");
    expect(serialized).not.toContain("U0RECIPIENT1");
    expect(serialized).not.toContain(fingerprint);
  });
});
