import { describe, expect, it } from "vitest";
import {
  PUBLIC_VOICE_AUDITION_CASES,
  publicVoiceAuditionCaseResultSchema,
  publicVoiceAuditionPacketSchema,
} from "../src/evaluation/public-voice-audition.js";

describe("public voice audition", () => {
  it("holds exactly six representative prompts for one bounded audition", () => {
    expect(PUBLIC_VOICE_AUDITION_CASES).toHaveLength(6);
    expect(new Set(PUBLIC_VOICE_AUDITION_CASES.map((item) => item.register))).toEqual(
      new Set(["advocacy", "biography", "explanation", "skeptical"]),
    );
  });

  it("requires three unique mechanics per audition prompt", () => {
    expect(publicVoiceAuditionPacketSchema.safeParse({
      version: "jolene.public-voice-audition.v1",
      capturedAt: "2026-09-04T00:00:00.000Z",
      model: "test",
      ownerOnly: true,
      cases: PUBLIC_VOICE_AUDITION_CASES.map((item) => ({
        ...item,
        candidates: ["a", "b", "c"].map((id) => ({
          id,
          mechanic: "playful_comparison",
          opening: "A question with a little useful mischief in it.",
          answer: "This is a full owner-only audition answer with enough content to make the schema useful for a meaningful review.",
          closing: "The answer can keep its feet on the floor.",
        })),
      })),
    }).success).toBe(false);
  });

  it("validates each checkpoint before it can be assembled into an owner packet", () => {
    expect(publicVoiceAuditionCaseResultSchema.safeParse({
      ...PUBLIC_VOICE_AUDITION_CASES[0],
      candidates: ["a", "b", "c"].map((id, index) => ({
        id,
        mechanic: ["playful_comparison", "literal_flip", "small_story_turn"][index],
        opening: "A question with a little useful mischief in it.",
        answer: "This is a full owner-only audition answer with enough content to make the schema useful for a meaningful review.",
        closing: "The answer can keep its feet on the floor.",
      })),
    }).success).toBe(true);
  });
});
