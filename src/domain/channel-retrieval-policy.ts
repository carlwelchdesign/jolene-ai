import type { ChannelKind } from "./conversation.js";
import type { CareerVisibility } from "./career-evidence.js";

export const CHANNEL_RETRIEVAL_POLICY_VERSION =
  "jolene.channel-retrieval.v1" as const;

export type RetrievalSurface = ChannelKind | "portfolio";
export type SlackDisclosureScope = "none" | "verified_owner_dm";

export interface ChannelRetrievalPolicy {
  readonly version: typeof CHANNEL_RETRIEVAL_POLICY_VERSION;
  readonly surface: RetrievalSurface;
  readonly disclosureScope: "local_private" | SlackDisclosureScope | "public";
  readonly conversationHistory: {
    readonly allowed: boolean;
    readonly scope: "same_thread_only";
  };
  readonly durableMemory: {
    readonly allowed: boolean;
    readonly sensitiveRequiresExplicitRequest: true;
  };
  readonly obsidianKnowledge: {
    readonly allowed: boolean;
    readonly citation: "note_path_and_heading";
  };
  readonly careerEvidence: {
    readonly allowedVisibilities: readonly Extract<
      CareerVisibility,
      "internal_approved" | "public_approved"
    >[];
    readonly citation: "source_id_and_claim_id" | "public_evidence_id";
  };
}

export interface ResolveChannelRetrievalPolicyInput {
  readonly surface: RetrievalSurface;
  readonly slackDisclosureScope?: SlackDisclosureScope;
}

export function resolveChannelRetrievalPolicy(
  input: ResolveChannelRetrievalPolicyInput,
): ChannelRetrievalPolicy {
  if (input.surface === "portfolio") {
    return policy(input.surface, "public", false, false, false, [
      "public_approved",
    ], "public_evidence_id");
  }

  if (input.surface === "cli" || input.surface === "private_chat") {
    return policy(input.surface, "local_private", true, true, true, [
      "internal_approved",
      "public_approved",
    ]);
  }

  if (
    input.surface === "slack_dm" &&
    input.slackDisclosureScope === "verified_owner_dm"
  ) {
    return policy(input.surface, "verified_owner_dm", true, true, true, [
      "internal_approved",
      "public_approved",
    ]);
  }

  return policy(
    input.surface,
    "none",
    true,
    false,
    false,
    [],
  );
}

export function policyAllowsCareerVisibility(
  retrievalPolicy: ChannelRetrievalPolicy,
  visibility: CareerVisibility,
): visibility is Extract<CareerVisibility, "internal_approved" | "public_approved"> {
  return retrievalPolicy.careerEvidence.allowedVisibilities.some(
    (allowed) => allowed === visibility,
  );
}

function policy(
  surface: RetrievalSurface,
  disclosureScope: ChannelRetrievalPolicy["disclosureScope"],
  conversationHistory: boolean,
  durableMemory: boolean,
  obsidianKnowledge: boolean,
  careerVisibilities: ChannelRetrievalPolicy["careerEvidence"]["allowedVisibilities"],
  careerCitation: ChannelRetrievalPolicy["careerEvidence"]["citation"] =
    "source_id_and_claim_id",
): ChannelRetrievalPolicy {
  return Object.freeze({
    version: CHANNEL_RETRIEVAL_POLICY_VERSION,
    surface,
    disclosureScope,
    conversationHistory: Object.freeze({
      allowed: conversationHistory,
      scope: "same_thread_only" as const,
    }),
    durableMemory: Object.freeze({
      allowed: durableMemory,
      sensitiveRequiresExplicitRequest: true as const,
    }),
    obsidianKnowledge: Object.freeze({
      allowed: obsidianKnowledge,
      citation: "note_path_and_heading" as const,
    }),
    careerEvidence: Object.freeze({
      allowedVisibilities: Object.freeze([...careerVisibilities]),
      citation: careerCitation,
    }),
  });
}
