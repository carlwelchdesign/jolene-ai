import { describe, expect, it } from "vitest";

import {
  validatePreallocationCapacityLedger,
} from "../src/personality/personality-preallocation-capacity-ledger.js";
import type { PreallocationCapacityLedger } from
  "../src/personality/personality-preallocation-capacity-ledger.js";

const hash = (value: number) => `sha256:${String(value).padStart(64, "0")}`;

describe("personality preallocation capacity ledger", () => {
  it("accepts a complete independently reviewed boundary without selecting", () => {
    expect(validatePreallocationCapacityLedger(register(), protocol(), ledger())).toMatchObject({
      sourceRegisterId: "S02", boundaryUnits: 3, eligibleUnits: 1,
      excludedRanges: 2, agreedHighRiskUnits: 1,
      ledgerFingerprint: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      sourceContentStored: false, selectionPerformed: false,
      observationCodingPerformed: false, runtimeActivation: "prohibited",
    });
  });

  it("rejects non-independent reviewers and non-consensus tags", () => {
    const sameReviewer = ledger();
    sameReviewer.independentReviewer.reviewerId = sameReviewer.primaryReviewer.reviewerId;
    expect(() => validatePreallocationCapacityLedger(register(), protocol(), sameReviewer))
      .toThrow("not independent");
    const falseConsensus = ledger();
    falseConsensus.eligibleUnits[0]!.agreedHighRiskStrata = ["humor"];
    expect(() => validatePreallocationCapacityLedger(register(), protocol(), falseConsensus))
      .toThrow("not reviewer consensus");
  });

  it("rejects missing boundary coverage and stale prerequisite fingerprints", () => {
    const missing = ledger();
    missing.excludedRanges = missing.excludedRanges.slice(0, 1);
    expect(() => validatePreallocationCapacityLedger(register(), protocol(), missing))
      .toThrow("coverage is missing or overlapping");
    const stale = ledger();
    stale.sourceRegisterFingerprint = hash(99);
    expect(() => validatePreallocationCapacityLedger(register(), protocol(), stale))
      .toThrow("prerequisites are stale");
  });

  it("rejects rule-incompatible locators and pre-prerequisite reviews", () => {
    const wrongLocator = ledger();
    wrongLocator.eligibleUnits[0]!.locator.kind = "pair-index";
    wrongLocator.eligibleUnits[0]!.locator.label = "pair-1";
    expect(() => validatePreallocationCapacityLedger(register(), protocol(), wrongLocator))
      .toThrow("locator kind mismatch");
    const staleReview = ledger();
    staleReview.primaryReviewer.reviewedAt = "2026-08-27T10:34:59Z";
    expect(() => validatePreallocationCapacityLedger(register(), protocol(), staleReview))
      .toThrow("chronology is invalid");
  });
});

function register() {
  return {
    registerFingerprint: hash(1), reviewedAt: "2026-08-27T10:36:00Z",
    events: [{
      sourceRegisterId: "S02", sourceEventId: "E002", accessState: "coding-ready",
      sourceContentFingerprint: hash(2),
    }],
  } as never;
}

function protocol() {
  return {
    protocolFingerprint: hash(3), highRiskTaxonomyFingerprint: hash(4),
    createdAt: "2026-08-27T10:14:00Z",
  } as never;
}

function ledger(): PreallocationCapacityLedger {
  return {
    schemaVersion: "jolene.personality-preallocation-capacity-ledger.v1",
    status: "independently-reviewed-before-allocation",
    sourceRegisterFingerprint: hash(1), boundaryProtocolFingerprint: hash(3),
    highRiskTaxonomyFingerprint: hash(4), sourceRegisterId: "S02", sourceEventId: "E002",
    sourceContentFingerprint: hash(2), segmentationRule: "paragraph-speaker-blocks-v1",
    boundaryManifestFingerprint: hash(5), ledgerFingerprintMapFingerprint: hash(6),
    policyAmendmentFingerprint: null,
    primaryReviewFingerprint: hash(7), independentReviewFingerprint: hash(8),
    sourceBoundaryUnitCount: 3, frozenAt: "2026-08-27T10:47:00Z",
    primaryReviewer: {
      reviewerId: "primary-reviewer", reviewerType: "ai", tool: "Codex",
      modelVersion: "test", reviewedAt: "2026-08-27T10:45:00Z",
    },
    independentReviewer: {
      reviewerId: "independent-reviewer", reviewerType: "ai", tool: "Codex",
      modelVersion: "test", reviewedAt: "2026-08-27T10:46:00Z",
    },
    eligibleUnits: [{
      unitId: "C-S02-0001", sourceUnitOrdinal: 1,
      locator: { kind: "paragraph-index", start: 1, end: 1, label: "paragraph-1" },
      segmentFingerprint: hash(11), primaryEligibility: "eligible",
      independentEligibility: "eligible", primaryHighRiskStrata: ["boundary", "humor"],
      independentHighRiskStrata: ["boundary"], agreedHighRiskStrata: ["boundary"],
      consensusWithheldHighRiskStrata: [],
      highRiskReviewState: "consensus",
    }],
    excludedRanges: [
      {
        exclusionId: "CX-S02-0001", sourceUnitStart: 0, sourceUnitEnd: 0,
        locator: { kind: "paragraph-index", start: 0, end: 0, label: "paragraph-0" },
        segmentFingerprint: hash(10), primaryReason: "interviewer-or-other-speaker",
        independentReason: "interviewer-or-other-speaker",
        agreedReason: "interviewer-or-other-speaker",
      },
      {
        exclusionId: "CX-S02-0002", sourceUnitStart: 2, sourceUnitEnd: 2,
        locator: { kind: "paragraph-index", start: 2, end: 2, label: "paragraph-2" },
        segmentFingerprint: hash(12), primaryReason: "speaker-attribution-unclear",
        independentReason: "speaker-attribution-unclear",
        agreedReason: "speaker-attribution-unclear",
      },
    ],
    sourceContentStored: false, frozenBeforeAllocation: true, selectionPerformed: false,
    observationCodingPerformed: false, runtimeActivation: "prohibited",
  };
}
