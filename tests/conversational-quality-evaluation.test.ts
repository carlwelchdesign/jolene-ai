import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  conversationalQualitySuiteSchema,
  evaluateConversationalQuality,
  type ConversationalQualityReview,
  type ConversationalQualitySuite,
} from "../src/evaluation/conversational-quality-evaluation.js";

const suite = conversationalQualitySuiteSchema.parse(JSON.parse(readFileSync(
  path.resolve("evaluations/conversational-quality-v1.json"),
  "utf8",
))) as ConversationalQualitySuite;

function passingReviews(): ConversationalQualityReview[] {
  return suite.cases.map((item) => ({
    caseId: item.id,
    answer: item.requiresEvidence
      ? "A direct, warm answer grounded in the cited example."
      : "A direct, kind, bounded answer.",
    citations: item.requiresEvidence ? [{ id: "evidence:1", label: "Visible evidence" }] : [],
    followUps: item.category === "follow_up" ? ["Which leadership example matters for this role?"] : [],
    scores: {
      taskSuccess: 4,
      evidenceTransparency: 4,
      warmthKindness: 4,
      witRestraint: 4,
      agencyBoundaries: 4,
      situationalCalibration: 4,
      originality: 4,
    },
    reviewerHardFailures: [],
  }));
}

describe("conversational quality evaluation", () => {
  it("requires every mandated conversational category", () => {
    expect(suite.cases).toHaveLength(9);
    expect(new Set(suite.cases.map((item) => item.category)).size).toBe(9);
  });

  it("passes only complete human-reviewed responses above the release thresholds", () => {
    expect(evaluateConversationalQuality(suite, passingReviews())).toMatchObject({
      gate: "pass",
      weightedMean: 4,
    });
  });

  it("blocks canned PR language and empty evidence rendering", () => {
    const reviews = passingReviews();
    reviews[0] = {
      ...reviews[0]!,
      answer: "The reviewed public record supports considering Carl.",
      citations: [],
    };
    const report = evaluateConversationalQuality(suite, reviews);

    expect(report.gate).toBe("fail");
    expect(report.cases[0]?.hardFailures).toEqual([
      "canned_pr_language",
      "empty_evidence_rendering",
    ]);
  });

  it("treats privacy, fabrication, substance, and citation drift as hard failures", () => {
    const reviews = passingReviews();
    reviews[1] = {
      ...reviews[1]!,
      reviewerHardFailures: [
        "fabricated_biography_or_quotation",
        "private_disclosure",
        "personality_displaces_substance",
        "factual_or_citation_drift",
      ],
    };
    expect(evaluateConversationalQuality(suite, reviews).cases[1]).toMatchObject({
      status: "fail",
      hardFailures: [
        "fabricated_biography_or_quotation",
        "factual_or_citation_drift",
        "personality_displaces_substance",
        "private_disclosure",
      ],
    });
  });

  it("requires complete review coverage and suppresses wit in grief", () => {
    expect(() => evaluateConversationalQuality(suite, passingReviews().slice(1)))
      .toThrow("Missing human review");
    const reviews = passingReviews();
    const griefIndex = suite.cases.findIndex((item) => item.category === "grief_high_stakes");
    reviews[griefIndex]!.scores.witRestraint = 3;
    expect(evaluateConversationalQuality(suite, reviews).cases[griefIndex]?.hardFailures)
      .toContain("high_stakes_personality_not_suppressed");
  });
});
