import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildPersonalityIndependentReviewV5,
  categoricalCodingFromTurn,
  independentAssignmentFingerprint,
  independentReviewReasons,
  personalityIndependentReviewV5Schema,
  validatePersonalityIndependentReviewV5,
} from "../src/personality/personality-independent-review-v5.js";
import { personalityPrimaryCodingArtifactV5Schema } from
  "../src/personality/personality-primary-coding-v5.js";
import { loadPersonalitySelectionArtifactsV5 } from
  "../src/personality/personality-selection-ledgers-v5.js";

let fixturePromise: ReturnType<typeof buildFixture> | undefined;

function fixture() {
  fixturePromise ??= buildFixture();
  return fixturePromise;
}

async function buildFixture() {
  const primaryText = await readFile(path.resolve("research/primary-coding-v5.json"), "utf8");
  const primary = personalityPrimaryCodingArtifactV5Schema.parse(JSON.parse(primaryText));
  const selection = await loadPersonalitySelectionArtifactsV5();
  const selected = selection.ledgers.flatMap((ledger) => ledger.selectedUnits);
  const independentReviewer = {
    reviewerId: "independent-reviewer-v5",
    reviewerType: "ai" as const,
    tool: "Structured blinded review fixture",
    modelVersion: "test-model",
  };
  const adjudicator = {
    reviewerId: "reconciliation-adjudicator-v5",
    reviewerType: "ai" as const,
    tool: "Structured adjudication fixture",
    modelVersion: "test-model",
  };
  const reviews = primary.turns.flatMap((turn, index) => {
    const reasons = independentReviewReasons(turn);
    if (reasons.length === 0) return [];
    const selectionId = selected[index]!.selectionId;
    const rawCoding = categoricalCodingFromTurn(turn);
    return [{
      observationId: turn.observationId,
      selectionId,
      sourceEventId: turn.sourceEventId,
      reviewReasons: [...reasons],
      assignedAt: "2026-08-28T20:00:00.000Z",
      codedAt: "2026-08-28T20:01:00.000Z",
      reconciledAt: "2026-08-28T20:02:00.000Z",
      independentAssignmentFingerprint: independentAssignmentFingerprint({
        observationId: turn.observationId,
        selectionId,
        reviewer: independentReviewer,
        rawCoding,
      }),
      primaryRawCoding: rawCoding,
      rawCoding,
      reconciledCoding: rawCoding,
      disposition: "agree" as const,
      changedFields: [],
      adjudicationRationale:
        "The blinded independent assignment matches the primary categorical coding.",
    }];
  });
  return buildPersonalityIndependentReviewV5({
    reviewedAt: "2026-08-28T20:03:00.000Z",
    primaryCodingFingerprint: digest(primaryText),
    selectionManifestFingerprint: selection.manifestFingerprint,
    independentReviewer,
    adjudicator,
    reviews,
    primary,
  });
}

describe("personality independent review v5", () => {
  it("accepts the complete stratified independent review set", async () => {
    await expect(validatePersonalityIndependentReviewV5(await fixture())).resolves.toMatchObject({
      reviewedTurns: 118,
      reviewRate: 118 / 120,
      sources: 10,
      researchContexts: 8,
      rawCategoricalAgreement: 1,
      traitFamilyKappa: 1,
      adjustedReviews: 0,
      thresholdsMet: true,
      sourceContentStored: false,
      runtimeActivation: "prohibited",
    });
  }, 90_000);

  it("rejects a missing mandatory review", async () => {
    const artifact = await fixture();
    const reviews = artifact.reviews.slice(1);
    await expect(validatePersonalityIndependentReviewV5({
      ...artifact,
      reviews,
      coverage: { ...artifact.coverage, reviewedTurns: reviews.length },
    })).rejects.toThrow("must contain 118 turns");
  }, 90_000);

  it("rejects a reviewer identity shared with the primary coder", async () => {
    const artifact = await fixture();
    await expect(validatePersonalityIndependentReviewV5({
      ...artifact,
      independentReviewer: {
        ...artifact.independentReviewer,
        reviewerId: "jolene-primary-coder-v5",
      },
    })).rejects.toThrow("identities are not separated");
  }, 90_000);

  it("rejects source content and runtime activation at the schema boundary", async () => {
    const artifact = await fixture();
    expect(() => personalityIndependentReviewV5Schema.parse({
      ...artifact,
      sourceText: "untrusted source content",
    })).toThrow();
    expect(() => personalityIndependentReviewV5Schema.parse({
      ...artifact,
      runtimeActivation: "allowed",
    })).toThrow();
  }, 90_000);
});

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
