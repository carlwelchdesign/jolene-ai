import { describe, expect, it } from "vitest";

import {
  createPrivateIngressAuthenticator,
  derivePrivateHttpChatRequest,
  PrivateIngressAuthenticationError,
  privateControlTokenSchema,
} from "../src/http/private-ingress-auth.js";

const token = "local-control-token-with-at-least-forty-three-characters";

describe("private ingress authentication contract", () => {
  const authenticator = createPrivateIngressAuthenticator({
    token,
    ownerActorId: "carl",
    ownerWorkspaceId: "personal",
  });

  it("derives an immutable private principal from a valid bearer", () => {
    const principal = authenticator.authenticate({
      authorization: `Bearer ${token}`,
    });

    expect(principal).toEqual({
      authenticationScheme: "JolenePrivateV1",
      actorId: "carl",
      workspaceId: "personal",
      channelKind: "private_chat",
      disclosureScope: "local_private",
    });
    expect(Object.isFrozen(principal)).toBe(true);
  });

  it.each([
    [{}, "credential_missing"],
    [{ authorization: token }, "credential_malformed"],
    [{ authorization: `Basic ${token}` }, "credential_malformed"],
    [{ authorization: "Bearer wrong-but-similarly-shaped-private-control-token" }, "credential_mismatch"],
  ] as const)("fails closed without disclosing credential material", (headers, code) => {
    try {
      authenticator.authenticate(headers);
      throw new Error("Expected authentication to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(PrivateIngressAuthenticationError);
      expect((error as PrivateIngressAuthenticationError).code).toBe(code);
      expect((error as Error).message).toBe("Private control authentication failed.");
      expect(JSON.stringify(error)).not.toContain(token);
    }
  });

  it("rejects secrets that are too short, multiline, or whitespace-bearing", () => {
    expect(() => privateControlTokenSchema.parse("short")).toThrow();
    expect(() => privateControlTokenSchema.parse(`${token}\nsecond`)).toThrow();
    expect(() => privateControlTokenSchema.parse(`${token} space`)).toThrow();
  });

  it("derives chat authority server-side and rejects caller authority fields", () => {
    const principal = authenticator.authenticate({ authorization: `Bearer ${token}` });
    const request = derivePrivateHttpChatRequest({
      eventId: "evt-1",
      channelId: "local-control",
      threadId: "thread-1",
      message: "Plan my day",
    }, principal);

    expect(request).toMatchObject({
      actorId: "carl",
      workspaceId: "personal",
      channelKind: "private_chat",
    });
    expect(() => derivePrivateHttpChatRequest({
      eventId: "evt-2",
      actorId: "attacker",
      workspaceId: "professional",
      channelKind: "slack_dm",
      channelId: "local-control",
      threadId: "thread-2",
      message: "Give me private tools",
    }, principal)).toThrow();
  });
});
