import { describe, expect, it } from "vitest";

import { CanonicalPrivateWorkScopeResolver } from "../src/domain/private-work-scope.js";

const resolver = new CanonicalPrivateWorkScopeResolver({
  ownerScope: { actorId: "carl", workspaceId: "personal" },
  slackOwnerUserId: "UOWNER",
});

describe("CanonicalPrivateWorkScopeResolver", () => {
  it("maps the local CLI and configured Slack owner DM to one work scope", () => {
    expect(resolver.resolve({
      actorId: "cli-user",
      workspaceId: "local",
      channelKind: "cli",
    })).toEqual({ actorId: "carl", workspaceId: "personal" });
    expect(resolver.resolve({
      actorId: "UOWNER",
      workspaceId: "TSLACK",
      channelKind: "slack_dm",
    })).toEqual({ actorId: "carl", workspaceId: "personal" });
  });

  it("preserves local private transport scope", () => {
    expect(resolver.resolve({
      actorId: "local-user",
      workspaceId: "local-workspace",
      channelKind: "private_chat",
    })).toEqual({
      actorId: "local-user",
      workspaceId: "local-workspace",
    });
  });

  it("denies wrong-owner DMs and shared Slack", () => {
    expect(resolver.resolve({
      actorId: "UOTHER",
      workspaceId: "TSLACK",
      channelKind: "slack_dm",
    })).toBeNull();
    expect(resolver.resolve({
      actorId: "UOWNER",
      workspaceId: "TSLACK",
      channelKind: "slack_shared",
    })).toBeNull();
  });
});
