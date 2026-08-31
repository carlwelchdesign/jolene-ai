import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  summarizeWorldClassPublicChatSuite,
  worldClassPublicChatSuiteSchema,
} from "../src/evaluation/world-class-public-chat-suite.js";

const suite = worldClassPublicChatSuiteSchema.parse(JSON.parse(readFileSync(
  path.resolve("evaluations/world-class-public-chat-v1.json"),
  "utf8",
)));

describe("world-class public chat launch suite", () => {
  it("locks the launch inventory and required regressions", () => {
    const summary = summarizeWorldClassPublicChatSuite(suite);
    expect(summary).toMatchObject({
      cases: 120,
      turns: 180,
      multiTurnThreads: 30,
      skepticalOrNegativeCases: 20,
    });
    expect(summary.suiteHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(suite.requiredRegressionPrompts.every((prompt) =>
      suite.cases.some((item) => item.turns.some((turn) => turn.prompt === prompt))
    )).toBe(true);
  });

  it("rejects shallow suites that inflate case count without required threads", () => {
    const shallow = {
      ...suite,
      cases: suite.cases.filter((item) => item.kind === "single_turn"),
    };
    expect(() => worldClassPublicChatSuiteSchema.parse(shallow)).toThrow();
  });

  it("rejects duplicate IDs and missing skeptical coverage", () => {
    const duplicate = structuredClone(suite);
    duplicate.cases[1]!.id = duplicate.cases[0]!.id;
    expect(() => worldClassPublicChatSuiteSchema.parse(duplicate)).toThrow(/unique/iu);

    const flatteringOnly = structuredClone(suite);
    flatteringOnly.cases = flatteringOnly.cases.map((item) => ({
      ...item,
      category: item.category === "skeptical" || item.category === "negative_fit"
        ? "supported" as const
        : item.category,
    }));
    expect(() => worldClassPublicChatSuiteSchema.parse(flatteringOnly)).toThrow(/Skeptical/iu);
  });

  it("requires each declared multi-turn thread to contain three bounded turns", () => {
    const truncated = structuredClone(suite);
    const thread = truncated.cases.find((item) => item.kind === "multi_turn");
    if (!thread) throw new Error("Expected a multi-turn fixture.");
    thread.turns = thread.turns.slice(0, 2);
    expect(() => worldClassPublicChatSuiteSchema.parse(truncated)).toThrow(/exactly 3 turns/iu);
  });
});
