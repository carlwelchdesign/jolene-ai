import { describe, expect, it } from "vitest";

import { evaluatePolicy } from "../src/domain/policy.js";

describe("evaluatePolicy", () => {
  it("allows private retrieval in private chat", () => {
    expect(
      evaluatePolicy({
        risk: "read_private",
        channelKind: "private_chat",
        explicitlyRequested: false,
      }).outcome,
    ).toBe("allow");
  });

  it("denies private retrieval in shared Slack", () => {
    expect(
      evaluatePolicy({
        risk: "read_private",
        channelKind: "slack_shared",
        explicitlyRequested: true,
      }).outcome,
    ).toBe("deny");
  });

  it("requires exact approval for every external write", () => {
    expect(
      evaluatePolicy({
        risk: "external_write",
        channelKind: "private_chat",
        explicitlyRequested: true,
      }).outcome,
    ).toBe("approval_required");
  });

  it("allows an explicitly requested reversible local change", () => {
    expect(
      evaluatePolicy({
        risk: "local_reversible_write",
        channelKind: "private_chat",
        explicitlyRequested: true,
      }).outcome,
    ).toBe("allow");
  });

  it("always denies prohibited capabilities", () => {
    expect(
      evaluatePolicy({
        risk: "prohibited",
        channelKind: "cli",
        explicitlyRequested: true,
      }).outcome,
    ).toBe("deny");
  });
});
