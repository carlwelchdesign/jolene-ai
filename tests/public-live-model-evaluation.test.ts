import { mkdtemp, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  evaluatePublicLiveModelSuite,
  publicLiveModelEvaluationSuiteSchema,
} from "../src/evaluation/public-live-model-evaluation.js";
import { writePublicLiveModelReviewPacket } from
  "../src/evaluation/public-live-model-review-packet.js";

const fixture = JSON.parse(await readFile(
  path.resolve("evaluations/public-live-model-v1.json"),
  "utf8",
)) as unknown;

describe("public live-model evaluation", () => {
  it("produces a privacy-safe passing report and a separate review packet", async () => {
    let now = 0;
    const result = await evaluatePublicLiveModelSuite(
      fixture,
      {
        generateMeasured: async (input) => ({
          answer: `Grounded answer about ${input.evidence[0]?.citationTitle ?? "evidence"}.`,
          inputTokens: 400,
          outputTokens: 50,
          totalTokens: 450,
        }),
      },
      () => {
        now += 50;
        return now;
      },
    );

    expect(result.report.gate).toBe("pass");
    expect(result.report.counts).toEqual({
      cases: 4,
      passed: 4,
      failed: 0,
      providerRequests: 3,
    });
    expect(result.report.totals).toEqual({
      inputTokens: 1_200,
      outputTokens: 150,
      totalTokens: 1_350,
      estimatedCostMicrousd: 2_625,
      maximumLatencyMilliseconds: 50,
    });
    expect(result.reviewPacket.cases).toHaveLength(4);
    expect(result.reviewPacket.cases[0]?.question).toContain("React");
    expect(result.reviewPacket.cases[0]?.answer).toContain("Typed product systems");

    const serializedReport = JSON.stringify(result.report);
    expect(serializedReport).not.toContain("What React");
    expect(serializedReport).not.toContain("Grounded answer");
    expect(serializedReport).not.toContain("Carl builds typed React");
    expect(serializedReport).not.toContain("/work/");
  });

  it("fails closed on unsafe generated disclosure without copying it into the report", async () => {
    const result = await evaluatePublicLiveModelSuite(fixture, {
      generateMeasured: async () => ({
        answer: "Leaked sk-1234567890abcdef credential.",
        inputTokens: 10,
        outputTokens: 10,
        totalTokens: 20,
      }),
    });

    expect(result.report.gate).toBe("fail");
    expect(result.report.cases.filter((item) => item.mode === "fallback"))
      .toHaveLength(3);
    expect(JSON.stringify(result.report)).not.toContain("sk-1234567890abcdef");
    expect(result.report.metrics.find((item) => item.id === "disclosure_safety"))
      .toMatchObject({ gate: "fail", passed: 0, total: 3 });
  });

  it("fails token and cost budgets with fixed non-content reasons", async () => {
    const result = await evaluatePublicLiveModelSuite(fixture, {
      generateMeasured: async () => ({
        answer: "A bounded grounded answer.",
        inputTokens: 3_000,
        outputTokens: 800,
        totalTokens: 3_800,
      }),
    });

    expect(result.report.gate).toBe("fail");
    expect(result.report.cases[0]?.failures).toEqual(expect.arrayContaining([
      "input_token_budget_exceeded",
      "output_token_budget_exceeded",
      "request_cost_budget_exceeded",
    ]));
  });

  it("reports provider failures without provider error text", async () => {
    const result = await evaluatePublicLiveModelSuite(fixture, {
      generateMeasured: async () => {
        throw new Error("provider secret response body");
      },
    });

    expect(result.report.gate).toBe("fail");
    expect(JSON.stringify(result.report)).not.toContain("provider secret");
    expect(result.report.cases[0]?.failures).toContain("provider_call_failed");
  });

  it("does not spend a provider request when deterministic selection drifts", async () => {
    const parsed = publicLiveModelEvaluationSuiteSchema.parse(fixture);
    const generateMeasured = vi.fn(async () => ({
      answer: "must not run",
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
    }));
    const drifted = {
      ...parsed,
      cases: parsed.cases.map((item, index) => index === 0
        ? {
          ...item,
          expectedEvidenceIds: [
            "career:00000000-0000-4000-8000-000000000002",
          ],
        }
        : item),
    };

    const result = await evaluatePublicLiveModelSuite(
      drifted,
      { generateMeasured },
    );

    expect(result.report.gate).toBe("fail");
    expect(result.report.cases[0]?.failures).toContain(
      "unexpected_evidence_selection",
    );
    expect(generateMeasured).toHaveBeenCalledTimes(2);
  });

  it("rejects suites without a deterministic provider-bypass case", () => {
    const parsed = publicLiveModelEvaluationSuiteSchema.parse(fixture);
    expect(() => publicLiveModelEvaluationSuiteSchema.parse({
      ...parsed,
      cases: parsed.cases.filter((item) => item.expectedMode === "model"),
    })).toThrow();
  });

  it("writes the human-review packet with owner-only permissions", async () => {
    const result = await evaluatePublicLiveModelSuite(fixture, {
      generateMeasured: async () => ({
        answer: "A bounded grounded answer.",
        inputTokens: 10,
        outputTokens: 10,
        totalTokens: 20,
      }),
    });
    const directory = await mkdtemp(path.join(os.tmpdir(), "jolene-live-review-"));
    const filePath = path.join(directory, "nested", "review.json");

    await writePublicLiveModelReviewPacket(filePath, result.reviewPacket);

    expect(JSON.parse(await readFile(filePath, "utf8"))).toEqual(
      result.reviewPacket,
    );
    expect((await stat(filePath)).mode & 0o777).toBe(0o600);
  });
});
