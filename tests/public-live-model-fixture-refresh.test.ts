import { describe, expect, it } from "vitest";

import {
  PublicLiveModelFixtureRefreshError,
  refreshPublicLiveModelEvaluationSuite,
} from "../src/evaluation/public-live-model-fixture-refresh.js";
import { publicCareerEvidenceDigest } from "../src/domain/public-career-evidence.js";
import { publicLiveModelEvaluationSuiteSchema } from
  "../src/evaluation/public-live-model-evaluation.js";
import fixture from "../evaluations/public-live-model-v1.json" with { type: "json" };

describe("refreshPublicLiveModelEvaluationSuite", () => {
  it("binds the fixture to exact artifact evidence and production selection", () => {
    const artifact = artifactWith("Carl builds React product systems.");
    const template = publicLiveModelEvaluationSuiteSchema.parse({
      ...fixture,
      evidence: artifact.evidence,
      corpusVersion: artifact.manifest.corpusVersion,
      cases: [
        { ...fixture.cases[0]!, question: "What React systems has Carl built?" },
        { ...fixture.cases[3]!, question: "What Kubernetes clusters has Carl operated?" },
      ],
    });

    const refreshed = refreshPublicLiveModelEvaluationSuite({ artifact, template });

    expect(refreshed.corpusVersion).toBe(artifact.manifest.corpusVersion);
    expect(refreshed.evidence).toEqual(artifact.evidence);
    expect(refreshed.cases[0]?.expectedEvidenceIds).toEqual([artifact.evidence[0]!.evidenceId]);
    expect(refreshed.cases[1]?.expectedEvidenceIds).toEqual([]);
  });

  it("fails when a supported case no longer retrieves approved evidence", () => {
    const artifact = artifactWith("Carl builds accessible product interfaces.");
    const template = publicLiveModelEvaluationSuiteSchema.parse({
      ...fixture,
      evidence: artifact.evidence,
      corpusVersion: artifact.manifest.corpusVersion,
      cases: [
        { ...fixture.cases[0]!, question: "What Kubernetes clusters has Carl operated?" },
        fixture.cases[3]!,
      ],
    });

    expect(() => refreshPublicLiveModelEvaluationSuite({ artifact, template }))
      .toThrow(PublicLiveModelFixtureRefreshError);
  });
});

function artifactWith(text: string) {
  const evidence = [{
    evidenceId: "career:00000000-0000-4000-8000-000000000001",
    claim: {
      claimId: "00000000-0000-4000-8000-000000000001",
      text,
      evidenceIds: ["career:00000000-0000-4000-8000-000000000001"],
      evidenceStrength: "limited" as const,
      maturity: "production" as const,
      limitations: ["The cited evidence supports only the claim as written."],
    },
    citation: {
      evidenceId: "career:00000000-0000-4000-8000-000000000001",
      title: "Product systems",
      href: "/work/sample#evidence",
      sourceType: "portfolio_page" as const,
      strength: "limited" as const,
      maturity: "production" as const,
      lastReviewedAt: "2026-08-27T12:00:00.000Z",
    },
  }];
  const digest = publicCareerEvidenceDigest({ evidence, revokedEvidenceIds: [] });
  return {
    manifest: {
      schemaVersion: "1.0.0" as const,
      corpusVersion: `career:${digest}` as const,
      corpusHash: `sha256:${digest}` as const,
      generatedAt: "2026-08-27T12:00:00.000Z",
      reviewedAt: "2026-08-27T12:00:00.000Z",
      evidenceCount: 1,
      revokedEvidenceIds: [],
    },
    evidence,
    conflicts: [],
  };
}
