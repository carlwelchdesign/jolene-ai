import type { ChannelKind } from "./conversation.js";
import type { SlackDisclosureScope } from "./channel-retrieval-policy.js";

export interface PrivateWorkScope {
  readonly actorId: string;
  readonly workspaceId: string;
}

export interface PrivateWorkScopeRequest extends PrivateWorkScope {
  readonly channelKind: ChannelKind;
}

export interface PrivateWorkScopeResolver {
  resolve(request: PrivateWorkScopeRequest): PrivateWorkScope | null;
  slackDisclosureScope(request: PrivateWorkScopeRequest): SlackDisclosureScope;
}

export interface CanonicalPrivateWorkScopeOptions {
  readonly ownerScope: PrivateWorkScope;
  readonly slackOwnerUserId: string | undefined;
  readonly slackOwnerWorkspaceId: string | undefined;
}

export class CanonicalPrivateWorkScopeResolver
  implements PrivateWorkScopeResolver
{
  constructor(private readonly options: CanonicalPrivateWorkScopeOptions) {}

  resolve(request: PrivateWorkScopeRequest): PrivateWorkScope | null {
    if (request.channelKind === "slack_shared") return null;
    if (request.channelKind === "cli") return this.options.ownerScope;
    if (request.channelKind === "slack_dm") {
      return this.isSlackOwner(request)
        ? this.options.ownerScope
        : null;
    }
    return {
      actorId: request.actorId,
      workspaceId: request.workspaceId,
    };
  }

  slackDisclosureScope(request: PrivateWorkScopeRequest): SlackDisclosureScope {
    return this.isSlackOwner(request)
      ? "verified_owner_dm"
      : "none";
  }

  private isSlackOwner(request: PrivateWorkScopeRequest): boolean {
    return request.channelKind === "slack_dm" &&
      Boolean(this.options.slackOwnerUserId) &&
      Boolean(this.options.slackOwnerWorkspaceId) &&
      request.actorId === this.options.slackOwnerUserId &&
      request.workspaceId === this.options.slackOwnerWorkspaceId;
  }
}

export class TransportPrivateWorkScopeResolver
  implements PrivateWorkScopeResolver
{
  resolve(request: PrivateWorkScopeRequest): PrivateWorkScope | null {
    return request.channelKind === "slack_shared"
      ? null
      : { actorId: request.actorId, workspaceId: request.workspaceId };
  }

  slackDisclosureScope(_request: PrivateWorkScopeRequest): SlackDisclosureScope {
    return "none";
  }
}
