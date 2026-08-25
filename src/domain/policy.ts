import type { ChannelKind } from "./conversation.js";

export type CapabilityRisk =
  | "read_public"
  | "read_private"
  | "local_reversible_write"
  | "external_write"
  | "sensitive_disclosure"
  | "destructive_or_costly"
  | "prohibited";

export type PolicyDecision =
  | { readonly outcome: "allow"; readonly reason: string }
  | { readonly outcome: "approval_required"; readonly reason: string }
  | { readonly outcome: "deny"; readonly reason: string };

export interface PolicyRequest {
  readonly risk: CapabilityRisk;
  readonly channelKind: ChannelKind;
  readonly explicitlyRequested: boolean;
}

export function isPrivateChannel(channelKind: ChannelKind): boolean {
  return (
    channelKind === "cli" ||
    channelKind === "private_chat" ||
    channelKind === "slack_dm"
  );
}

export function evaluatePolicy(request: PolicyRequest): PolicyDecision {
  if (request.risk === "prohibited") {
    return { outcome: "deny", reason: "This capability is prohibited." };
  }

  if (request.risk === "read_public") {
    return { outcome: "allow", reason: "Public read-only work is allowed." };
  }

  if (request.risk === "read_private") {
    return isPrivateChannel(request.channelKind)
      ? {
          outcome: "allow",
          reason: "Private retrieval is allowed in this private channel.",
        }
      : {
          outcome: "deny",
          reason: "Private knowledge is unavailable in shared channels.",
        };
  }

  if (request.risk === "local_reversible_write") {
    return request.explicitlyRequested
      ? {
          outcome: "allow",
          reason: "The user explicitly requested this scoped local change.",
        }
      : {
          outcome: "approval_required",
          reason: "A local write needs explicit task authorization.",
        };
  }

  return {
    outcome: "approval_required",
    reason: "Consequential work requires exact, scoped approval.",
  };
}
