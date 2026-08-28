import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  hashPublicLiveModelSuite,
  publicLiveModelEvaluationSuiteSchema,
} from "../src/evaluation/public-live-model-evaluation.js";
import { preflightPublicLiveModelSuite } from
  "../src/evaluation/public-live-model-preflight.js";

const suite = publicLiveModelEvaluationSuiteSchema.parse(JSON.parse(await readFile(
  path.resolve("evaluations/public-live-model-v1.json"),
  "utf8",
)));

function priorReport() {
  return {
    suiteHash: hashPublicLiveModelSuite(suite),
    model: suite.model,
    corpusVersion: suite.corpusVersion,
    cases: suite.cases.map((item) => ({
      id: item.id,
      inputTokens: item.expectedMode === "model" ? 2_824 : 0,
      outputTokens: item.expectedMode === "model" ? 324 : 0,
    })),
  };
}

describe("public live-model request preflight", () => {
  it("proves the minimized exact-suite request boundary without a provider", () => {
    const report = preflightPublicLiveModelSuite(suite, priorReport());

    expect(report.gate).toBe("pass");
    expect(report.counts).toEqual({
      cases: 4,
      providerRequests: 3,
      providerBypasses: 1,
    });
    expect(report.cases.filter((item) => item.mode === "model").every((item) =>
      item.reductionBps >= 6_100 &&
      item.conservativeInputTokenCeiling <= 2_000 &&
      item.gate === "pass"
    )).toBe(true);
    expect(JSON.stringify(report)).not.toContain("What React");
    expect(JSON.stringify(report)).not.toContain("claimText");
  });

  it("rejects a prior measurement from a different suite", () => {
    expect(() => preflightPublicLiveModelSuite(suite, {
      ...priorReport(),
      suiteHash: "f".repeat(64),
    })).toThrow("does not match the exact suite");
  });
});
