import { describe, expect, it } from "vitest";

import {
  createPrivateIngressAuthenticator,
  createPrivateControlRequestGuard,
  derivePrivateHttpChatRequest,
  PrivateIngressAuthenticationError,
  privateControlTokenSchema,
} from "../src/http/private-ingress-auth.js";

const token = "local-control-token-with-at-least-forty-three-characters";

describe("private ingress authentication contract", () => {
  const auditEvents: unknown[] = [];
  const authenticator = createPrivateIngressAuthenticator({
    token,
    ownerActorId: "carl",
    ownerWorkspaceId: "personal",
    audit(event) { auditEvents.push(event); },
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
    [{ authorization: `Basic ${Buffer.from(`other:${token}`).toString("base64")}` }, "credential_malformed"],
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

  it("accepts browser-native basic auth for the fixed Jolene principal", () => {
    const authorization = Buffer.from(`jolene:${token}`).toString("base64");
    expect(authenticator.authenticate({ authorization: `Basic ${authorization}` }))
      .toMatchObject({ actorId: "carl", workspaceId: "personal" });
  });

  it("combines loopback host, same-origin, and credential checks", () => {
    const guard = createPrivateControlRequestGuard({
      token,
      ownerActorId: "carl",
      ownerWorkspaceId: "personal",
    });
    expect(guard.authorize({
      host: "127.0.0.1:8421",
      origin: "http://127.0.0.1:8421",
      authorization: `Bearer ${token}`,
    })).toMatchObject({ disclosureScope: "local_private" });
    expect(() => guard.authorize({
      host: "127.0.0.1:8421",
      origin: "https://untrusted.example",
      authorization: `Bearer ${token}`,
    })).toThrow();
    expect(() => guard.authorize({
      host: "192.168.1.4:8421",
      authorization: `Bearer ${token}`,
    })).toThrow();
  });

  it("rejects secrets that are too short, multiline, or whitespace-bearing", () => {
    expect(() => privateControlTokenSchema.parse("short")).toThrow();
    expect(() => privateControlTokenSchema.parse(`${token}\nsecond`)).toThrow();
    expect(() => privateControlTokenSchema.parse(`${token} space`)).toThrow();
  });

  it("emits content-minimizing versioned reason codes", () => {
    auditEvents.length = 0;
    authenticator.authenticate({ authorization: `Bearer ${token}` });
    expect(() => authenticator.authenticate({ authorization: "Bearer wrong" }))
      .toThrow(PrivateIngressAuthenticationError);
    expect(auditEvents).toEqual([
      {
        policyVersion: "jolene.private-control-auth.v1",
        outcome: "authorized",
        reasonCode: "credential_accepted_bearer",
      },
      {
        policyVersion: "jolene.private-control-auth.v1",
        outcome: "denied",
        reasonCode: "credential_mismatch",
      },
    ]);
    expect(JSON.stringify(auditEvents)).not.toContain(token);
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
