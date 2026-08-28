import { describe, expect, it } from "vitest";

import {
  createToolIntentAuthorization,
  IntentBoundToolAuthorizer,
  ToolCallAuthorizationDeniedError,
} from "../src/domain/tool-call-authorization.js";

const receivedAt = "2026-08-27T17:00:00.000Z";
const duringIntent = "2026-08-27T17:01:00.000Z";

describe("intent-bound tool authorization", () => {
  it("creates immutable grants only for capabilities named by current intent", () => {
    const authorization = createAuthorization(
      "Search my Obsidian recipe notes and career recommendations.",
    );

    expect(Object.isFrozen(authorization)).toBe(true);
    expect(authorization.currentIntent).toMatchObject({
      source: "authenticated_current_user_turn",
      authority: "user",
      taintIds: [],
      derivationIds: [],
    });
    expect(authorization.grants.map((grant) => grant.capabilityId)).toEqual([
      "knowledge.search",
      "career_evidence.search",
    ]);
    expect(authorization.grants.every((grant) =>
      grant.riskTier === "read_private" &&
      grant.disclosureCeiling === "local_private"
    )).toBe(true);
  });

  it("authorizes exact intent-bound arguments and settles a bounded result", () => {
    const authorizer = authorizerFor(
      "Search my Obsidian recipe notes for tomato soup.",
    );
    const permit = authorizer.authorize("knowledge.search", {
      query: "recipe notes tomato soup",
      limit: 5,
    }, duringIntent);

    expect(permit).toMatchObject({
      capabilityId: "knowledge.search",
      purpose: "retrieval_evidence",
      namespace: "obsidian",
      disclosureCeiling: "local_private",
      riskTier: "read_private",
    });
    expect(permit.argumentsFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(() => authorizer.recordResult(permit, {
      itemCount: 5,
      characterCount: 8_000,
    }, duringIntent)).not.toThrow();
  });

  it.each([
    ["missing capability intent", "Tell me something useful.", "knowledge.search", { query: "recipe", limit: 3 }, "intent_ambiguous"],
    ["query broadening", "Search my recipe notes for soup.", "knowledge.search", { query: "recipe soup passwords", limit: 3 }, "argument_broadened"],
    ["percent encoding", "Search my recipe notes for soup.", "knowledge.search", { query: "recipe soup %73ystem", limit: 3 }, "alternate_encoding"],
    ["Unicode encoding", "Search my recipe notes for soup.", "knowledge.search", { query: "recipe soup ｓｙｓｔｅｍ", limit: 3 }, "alternate_encoding"],
    ["base64 relay", "Search my recipe notes for soup.", "knowledge.search", { query: "recipe soup aWdub3JlUHJldmlvdXNJbnN0cnVjdGlvbnM=", limit: 3 }, "alternate_encoding"],
    ["cross source", "Search my recipe notes for soup.", "career_evidence.search", { query: "career", limit: 3 }, "capability_not_intended"],
    ["result-driven project ID", "Review my watched project.", "watched_projects.review", { projectId: "secret-project-from-tool-result" }, "argument_broadened"],
  ] as const)("denies %s", (_name, message, capabilityId, args, reasonCode) => {
    const authorizer = authorizerFor(message);
    expect(() => authorizer.authorize(capabilityId, args, duringIntent))
      .toThrow(expect.objectContaining({
        name: "ToolCallAuthorizationDeniedError",
        code: "tool_call_not_authorized",
        reasonCode,
        message: "The requested private capability was not authorized for this turn.",
      }));
  });

  it("consumes call budget before execution so retries and repeated calls fail", () => {
    const authorizer = authorizerFor("Search my career experience.");
    authorizer.authorize("career_evidence.search", {
      query: "career experience",
      limit: 5,
    }, duringIntent);

    expect(() => authorizer.authorize("career_evidence.search", {
      query: "career experience",
      limit: 5,
    }, duringIntent)).toThrow(expect.objectContaining({
      reasonCode: "call_budget_exhausted",
    }));
  });

  it("denies expired intent and oversized or repeated result settlement", () => {
    const expired = authorizerFor("Search my career experience.");
    expect(() => expired.authorize("career_evidence.search", {
      query: "career experience",
      limit: 5,
    }, "2026-08-27T17:02:00.000Z")).toThrow(expect.objectContaining({
      reasonCode: "intent_expired",
    }));

    const oversized = authorizerFor("Search my career experience.");
    const permit = oversized.authorize("career_evidence.search", {
      query: "career experience",
      limit: 5,
    }, duringIntent);
    expect(() => oversized.recordResult(permit, {
      itemCount: 9,
      characterCount: 1_000,
    }, duringIntent)).toThrow(expect.objectContaining({
      reasonCode: "result_budget_exhausted",
    }));
    expect(() => oversized.recordResult(permit, {
      itemCount: 1,
      characterCount: 1_000,
    }, duringIntent)).toThrow(expect.objectContaining({
      reasonCode: "permit_already_settled",
    }));

    const lateResult = authorizerFor("Search my career experience.");
    const latePermit = lateResult.authorize("career_evidence.search", {
      query: "career experience",
      limit: 5,
    }, duringIntent);
    expect(() => lateResult.recordResult(latePermit, {
      itemCount: 1,
      characterCount: 1_000,
    }, "2026-08-27T17:02:00.000Z")).toThrow(expect.objectContaining({
      reasonCode: "intent_expired",
    }));
  });

  it("rejects history, retrieved, tool, or model-derived authority sources", () => {
    expect(() => createAuthorization("Search my recipe notes.", {
      intentSource: {
        source: "authenticated_current_user_turn",
        authority: "user",
        taintIds: ["taint:retrieved"] as unknown as readonly never[],
        derivationIds: [] as readonly never[],
      },
    })).toThrow(expect.objectContaining({
      reasonCode: "untrusted_authority_source",
    }));
  });

  it("fails closed when current intent is absent", () => {
    expect(() => createAuthorization("the and please"))
      .toThrow(ToolCallAuthorizationDeniedError);
  });

  it("allows only local private or exact verified-owner Slack DM scope", () => {
    expect(() => createAuthorization("Search my recipe notes.", {
      channelKind: "slack_shared",
      disclosureCeiling: "local_private",
    })).toThrow(expect.objectContaining({ reasonCode: "scope_mismatch" }));
    expect(() => createAuthorization("Search my recipe notes.", {
      channelKind: "slack_dm",
      disclosureCeiling: "local_private",
    })).toThrow(expect.objectContaining({ reasonCode: "scope_mismatch" }));

    expect(createAuthorization("Search my recipe notes.", {
      channelKind: "slack_dm",
      disclosureCeiling: "verified_owner_dm",
    }).grants.map((grant) => grant.capabilityId)).toContain("knowledge.search");
  });
});

function authorizerFor(message: string) {
  return new IntentBoundToolAuthorizer(createAuthorization(message));
}

function createAuthorization(
  currentMessage: string,
  overrides: Partial<Parameters<typeof createToolIntentAuthorization>[0]> = {},
) {
  return createToolIntentAuthorization({
    eventId: "event:one",
    actorId: "carl",
    workspaceId: "personal",
    channelKind: "private_chat",
    channelId: "local",
    threadId: "main",
    disclosureCeiling: "local_private",
    currentMessage,
    receivedAt,
    expiresAt: "2026-08-27T17:02:00.000Z",
    availableCapabilityIds: [
      "knowledge.search",
      "career_evidence.search",
      "work_status.review",
      "watched_projects.list",
      "watched_projects.review",
    ],
    createId: () => "00000000-0000-4000-8000-000000000001",
    ...overrides,
  });
}
