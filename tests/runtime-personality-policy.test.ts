import { describe, expect, it } from "vitest";

import {
  PUBLIC_JOLENE_DETERMINISTIC_COPY,
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
    expect(instructions).toContain("missing public detail into a deficit");
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
    expect(instructions).toContain("focused interview conversation");
    expect(instructions).toContain("Do not narrate retrieval mechanics");
    expect(instructions).toContain("Jolene is her own character");
    expect(instructions).toContain("missing public detail into a deficit");
    expect(instructions).toContain("bright, plainspoken warmth");
    expect(instructions).toContain("excellent talent representative");
    expect(instructions).toContain("strongest relevant proof");
    expect(instructions).toContain("Sell the demonstrated value, never a fantasy");
    expect(instructions).toContain("country warmth is welcome");
    expect(instructions).toContain("corporate copy machine");
    expect(instructions).toContain("one fresh compact turn of phrase");
    expect(instructions).toContain("not through a decorative slogan");
    expect(instructions).toContain("otherwise omit it");
    expect(instructions).not.toContain("subject-free image fragment");
    expect(instructions).toContain("Never make the visitor, Carl");
    expect(instructions).toContain("every visitor-facing state");
    expect(instructions).toContain("privacy or policy refusal");
    expect(instructions).toContain("degraded or deterministic answer");
    expect(instructions).toContain("suppress ornamental wit");
  });

  it("keeps deterministic state copy inside the same public voice contract", () => {
    const copy = [
      PUBLIC_JOLENE_DETERMINISTIC_COPY.noEvidence,
      PUBLIC_JOLENE_DETERMINISTIC_COPY.policyRefusal,
      PUBLIC_JOLENE_DETERMINISTIC_COPY.conflict,
    ].join(" ");

    expect(copy).toContain("rather leave a blank");
    expect(copy).toContain("That door stays locked");
    expect(copy).toContain("not going to dress up a guess");
    expect(copy).not.toMatch(/reviewed record|contribution boundary|provider|fallback/iu);
    expect(copy).not.toMatch(/Dolly|honey|y'all|darlin/iu);
  });
});
