import { readFileSync } from "node:fs";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  conversationalQualitySuiteSchema,
  captureConversationalQualitySuite,
  evaluateConversationalQuality,
  inspectConversationalQualityCapture,
  type ConversationalQualityReview,
  type ConversationalQualitySuite,
} from "../src/evaluation/conversational-quality-evaluation.js";
import { writeConversationalQualityCapturePacket } from
  "../src/evaluation/conversational-quality-capture-store.js";

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

  it("captures every case in order and writes a private review packet", async () => {
    const packet = await captureConversationalQualitySuite(
      suite,
      "test-model",
      {
        respond: async (item) => ({
          answer: `Answer for ${item.id}`,
          citations: [],
          followUps: [],
          mode: "model",
        }),
      },
      "2026-08-27T12:00:00.000Z",
    );
    const directory = await mkdtemp(path.join(os.tmpdir(), "jolene-conversation-eval-"));
    const filePath = path.join(directory, "nested", "capture.json");

    await writeConversationalQualityCapturePacket(filePath, packet);

    expect(packet.cases.map((item) => item.id)).toEqual(
      suite.cases.map((item) => item.id),
    );
    expect(JSON.parse(await readFile(filePath, "utf8"))).toEqual(packet);
    expect((await stat(filePath)).mode & 0o777).toBe(0o600);
  });

  it("preflights canned language and missing structured evidence before human review", async () => {
    const packet = await captureConversationalQualitySuite(suite, "test-model", {
      respond: async (item) => ({
        answer: item.category === "recruiter"
          ? "The reviewed public record supports considering Carl."
          : item.category === "continuity"
          ? "I don’t have the prior project example in this thread."
          : "A useful response.",
        citations: item.requiresEvidence && item.category !== "continuity"
          ? [{ id: "evidence:1", label: "Evidence" }]
          : [],
        followUps: [],
        mode: "model",
      }),
    });

    const preflight = inspectConversationalQualityCapture(suite, packet);

    expect(preflight.gate).toBe("fail");
    expect(preflight.cases.find((item) => item.id === "conversation:recruiter-hire"))
      .toMatchObject({ hardFailures: ["canned_pr_language"] });
    expect(preflight.cases.find((item) => item.id === "conversation:continuity"))
      .toMatchObject({
        hardFailures: [
          "empty_evidence_rendering",
          "conversation_continuity_lost",
        ],
      });
  });
});
