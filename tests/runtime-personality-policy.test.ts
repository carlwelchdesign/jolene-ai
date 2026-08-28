import { describe, expect, it } from "vitest";

import {
  PUBLIC_JOLENE_PERSONALITY_INSTRUCTIONS,
  RUNTIME_PERSONALITY_POLICY_VERSION,
  buildPrivateJoleneInstructions,
} from "../src/personality/runtime-personality-policy.js";

describe("runtime personality policy", () => {
  it("activates a versioned, noticeable private personality with governed retrieval", () => {
    const instructions = buildPrivateJoleneInstructions(
      "Base safety instructions.",
      "private_chat",
    );

    expect(instructions).toContain("Base safety instructions.");
    expect(instructions).toContain(RUNTIME_PERSONALITY_POLICY_VERSION);
    expect(instructions).toContain("noticeable, familiar personality");
    expect(instructions).toContain("search the approved private knowledge source");
    expect(instructions).toContain("not a press release");
    expect(instructions).toContain("one light turn of phrase at most");
    expect(instructions).toContain("Owner-designed baseline behavior");
    expect(instructions).toContain("Audited admitted behavior");
    expect(instructions).toContain("names evidence gaps plainly");
  });

  it("keeps shared Slack low-intimacy and blocks private-vault disclosure", () => {
    const instructions = buildPrivateJoleneInstructions("Base.", "slack_shared");

    expect(instructions).toContain("low-intimacy");
    expect(instructions).toContain("Never reveal private-vault details");
    expect(instructions).not.toContain("familiar personality with Carl");
  });

  it("rolls every private and Slack channel back to the unchanged base policy", () => {
    for (const channel of [
      "cli",
      "private_chat",
      "slack_dm",
      "slack_private",
      "slack_shared",
    ] as const) {
      expect(buildPrivateJoleneInstructions(
        "  Base safety, privacy, grounding, and capability policy.  ",
        channel,
        "neutral",
      )).toBe("Base safety, privacy, grounding, and capability policy.");
    }
  });

  it("gives public Jolene direct anti-canned and skeptical-answer guidance", () => {
    const instructions = PUBLIC_JOLENE_PERSONALITY_INSTRUCTIONS.join(" ");

    expect(instructions).toContain("not a press release");
    expect(instructions).toContain("credible role-fit risks or unknowns");
    expect(instructions).toContain("Do not narrate retrieval mechanics");
    expect(instructions).toContain("Jolene is her own character");
    expect(instructions).toContain("names evidence gaps plainly");
  });
});
