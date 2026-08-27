import type { ChannelKind } from "./conversation.js";

export interface PrivateWorkScope {
  readonly actorId: string;
  readonly workspaceId: string;
}

export interface PrivateWorkScopeRequest extends PrivateWorkScope {
  readonly channelKind: ChannelKind;
}

export interface PrivateWorkScopeResolver {
  resolve(request: PrivateWorkScopeRequest): PrivateWorkScope | null;
}

export interface CanonicalPrivateWorkScopeOptions {
  readonly ownerScope: PrivateWorkScope;
  readonly slackOwnerUserId: string | undefined;
}

export class CanonicalPrivateWorkScopeResolver
  implements PrivateWorkScopeResolver
{
  constructor(private readonly options: CanonicalPrivateWorkScopeOptions) {}

  resolve(request: PrivateWorkScopeRequest): PrivateWorkScope | null {
    if (request.channelKind === "slack_shared") return null;
    if (request.channelKind === "cli") return this.options.ownerScope;
    if (request.channelKind === "slack_dm") {
      return this.options.slackOwnerUserId &&
          request.actorId === this.options.slackOwnerUserId
        ? this.options.ownerScope
        : null;
    }
    return {
      actorId: request.actorId,
      workspaceId: request.workspaceId,
    };
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
}
