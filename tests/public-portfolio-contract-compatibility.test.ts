import { describe, expect, it } from "vitest";

import {
  publicCareerEvidenceManifestSchema,
} from "../src/domain/public-career-evidence.js";
import {
  portfolioAnswerRequestSchema,
  portfolioAnswerResponseSchema,
  portfolioJobFitRequestSchema,
  portfolioJobFitResponseSchema,
  publicEvidenceCitationSchema,
  publicJoleneErrorResponseSchema,
} from "../src/domain/public-portfolio-contract.js";
import { DeterministicPublicAnswerService } from "../src/public/public-answer-service.js";
import { DeterministicPublicJobFitService } from "../src/public/public-job-fit-service.js";
import {
  createPublicEvidenceArtifact,
  createPublicEvidenceRecord,
} from "./helpers/public-evidence-fixture.js";

describe("frozen public portfolio v1 compatibility", () => {
  it("rejects opaque sessions while allowing additive minimized answer context", () => {
    expect(portfolioAnswerRequestSchema.safeParse({
      question: "What has Carl built?",
      sessionToken: "retired-v1-field",
    }).success).toBe(false);
    expect(portfolioJobFitRequestSchema.safeParse({
      jobDescription: "React product systems",
      sessionToken: "retired-v1-field",
    }).success).toBe(false);

    const artifact = createPublicEvidenceArtifact();
    expect(new DeterministicPublicAnswerService().answer(artifact, {
      question: "What React systems has Carl built?",
    })).not.toHaveProperty("sessionToken");
    expect(portfolioAnswerRequestSchema.safeParse({
      question: "What about its architecture?",
      conversationContext: {
        corpusVersion: artifact.manifest.corpusVersion,
        projectPath: "/work/jolene-ai",
        turnCount: 1,
        expiresAt: "2026-08-28T20:15:00.000Z",
      },
    }).success).toBe(true);
    expect(new DeterministicPublicJobFitService().compare(artifact, {
      jobDescription: "React product systems",
    })).not.toHaveProperty("sessionToken");
  });

  it("enforces frozen answer response bounds", () => {
    const artifact = createPublicEvidenceArtifact();
    const response = new DeterministicPublicAnswerService().answer(artifact, {
      question: "What React systems has Carl built?",
    });

    expect(portfolioAnswerResponseSchema.safeParse(response).success).toBe(true);
    expect(portfolioAnswerResponseSchema.safeParse({
      ...response,
      answer: "x".repeat(4_001),
    }).success).toBe(false);
    expect(portfolioAnswerResponseSchema.safeParse({
      ...response,
      limitations: Array.from({ length: 9 }, (_, index) => `Limit ${index}`),
    }).success).toBe(false);
    expect(portfolioAnswerResponseSchema.safeParse({
      ...response,
      claims: [{
        ...response.claims[0],
        limitations: Array.from({ length: 9 }, (_, index) => `Limit ${index}`),
      }],
    }).success).toBe(false);
  });

  it("keeps deterministic output within bounds for maximal eligible evidence", () => {
    const evidence = Array.from({ length: 5 }, (_, index) =>
      createPublicEvidenceRecord(index + 1, {
        text: `React ${"x".repeat(3_994)}`,
        limitations: Array.from(
          { length: 8 },
          (__, limitation) => `Evidence ${index} limitation ${limitation}`,
        ),
      }));
    const response = new DeterministicPublicAnswerService().answer(
      createPublicEvidenceArtifact(evidence),
      { question: "React" },
    );

    expect(response.claims).toHaveLength(5);
    expect(response.answer.length).toBeLessThanOrEqual(4_000);
    expect(response.limitations).toHaveLength(8);
    expect(portfolioAnswerResponseSchema.safeParse(response).success).toBe(true);
  });

  it("allows only site-relative citation destinations", () => {
    const citation = createPublicEvidenceArtifact().evidence[0]?.citation;
    expect(publicEvidenceCitationSchema.safeParse(citation).success).toBe(true);
    expect(publicEvidenceCitationSchema.safeParse({
      ...citation,
      href: "https://example.com/unreviewed-destination",
    }).success).toBe(false);
    expect(publicEvidenceCitationSchema.safeParse({
      ...citation,
      href: "//example.com/protocol-relative",
    }).success).toBe(false);
  });

  it("keeps missing and unknown requirements citation-free", () => {
    const artifact = createPublicEvidenceArtifact();
    const response = new DeterministicPublicJobFitService().compare(artifact, {
      jobDescription: "Kubernetes cluster operations",
    });
    const evidenceId = artifact.evidence[0]?.evidenceId;

    expect(response.requirements[0]?.assessment).toBe("unknown");
    expect(portfolioJobFitResponseSchema.safeParse({
      ...response,
      requirements: [{
        ...response.requirements[0],
        evidenceIds: [evidenceId],
      }],
      citations: [artifact.evidence[0]?.citation],
    }).success).toBe(false);
  });

  it("uses the bounded safe error envelope and version behavior", () => {
    const base = {
      schemaVersion: "1.0.0",
      code: "unavailable",
      message: "Public Jolene is temporarily unavailable.",
      requestId: "req:00000000000000000000000000000001",
    };
    expect(publicJoleneErrorResponseSchema.safeParse(base).success).toBe(true);
    expect(publicJoleneErrorResponseSchema.safeParse({
      ...base,
      message: "x".repeat(241),
    }).success).toBe(false);
    expect(publicJoleneErrorResponseSchema.safeParse({
      ...base,
      code: "version_mismatch",
    }).success).toBe(false);
    expect(publicJoleneErrorResponseSchema.safeParse({
      ...base,
      code: "version_mismatch",
      supportedSchemaVersions: ["1.0.0"],
    }).success).toBe(true);
  });

  it("permits a null review time only for a valid empty corpus", () => {
    const empty = createPublicEvidenceArtifact([]).manifest;
    expect(publicCareerEvidenceManifestSchema.safeParse({
      ...empty,
      reviewedAt: null,
    }).success).toBe(true);
    expect(publicCareerEvidenceManifestSchema.safeParse({
      ...createPublicEvidenceArtifact().manifest,
      reviewedAt: null,
    }).success).toBe(false);
  });
});
