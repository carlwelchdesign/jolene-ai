import { describe, expect, it } from "vitest";

import {
  createPublicAnswerFallbackSnapshot,
  PUBLIC_ANSWER_GROUNDING_CONTRACT_VERSION,
  PUBLIC_ANSWER_GROUNDING_LIMITS,
  PUBLIC_ANSWER_GROUNDING_REASON_CODES,
  PUBLIC_MODEL_MUTABLE_ANSWER_FIELDS,
  publicAnswerGroundedGenerationSchema,
  publicAnswerGroundingResultSchema,
} from "../src/public/public-answer-grounding-contract.js";
import { DeterministicPublicAnswerService } from
  "../src/public/public-answer-service.js";
import { createPublicEvidenceArtifact } from
  "./helpers/public-evidence-fixture.js";

describe("public answer grounding contract", () => {
  it("requires exact evidence support for every generated segment", () => {
    const artifact = createPublicEvidenceArtifact();
    const evidenceId = artifact.evidence[0]!.evidenceId;
    expect(publicAnswerGroundedGenerationSchema.parse({
      contractVersion: PUBLIC_ANSWER_GROUNDING_CONTRACT_VERSION,
      corpusVersion: artifact.manifest.corpusVersion,
      segments: [{ text: "Carl built a typed React product system.", supportIds: [evidenceId] }],
    }).segments[0]?.supportIds).toEqual([evidenceId]);

    for (const supportIds of [[], [evidenceId, evidenceId]]) {
      expect(publicAnswerGroundedGenerationSchema.safeParse({
        contractVersion: PUBLIC_ANSWER_GROUNDING_CONTRACT_VERSION,
        corpusVersion: artifact.manifest.corpusVersion,
        segments: [{ text: "Unsupported material sentence.", supportIds }],
      }).success).toBe(false);
    }
  });

  it("bounds segment and support breadth before semantic validation", () => {
    const artifact = createPublicEvidenceArtifact();
    const segment = {
      text: "x".repeat(PUBLIC_ANSWER_GROUNDING_LIMITS.segmentCharacters + 1),
      supportIds: [artifact.evidence[0]!.evidenceId],
    };
    expect(publicAnswerGroundedGenerationSchema.safeParse({
      contractVersion: PUBLIC_ANSWER_GROUNDING_CONTRACT_VERSION,
      corpusVersion: artifact.manifest.corpusVersion,
      segments: [segment],
    }).success).toBe(false);
  });

  it("uses stable content-minimizing accepted and rejected results", () => {
    expect(publicAnswerGroundingResultSchema.parse({
      status: "accepted",
      contractVersion: PUBLIC_ANSWER_GROUNDING_CONTRACT_VERSION,
      segmentCount: 2,
      supportCount: 3,
      elapsedMilliseconds: 4,
    })).not.toHaveProperty("answer");
    expect(publicAnswerGroundingResultSchema.parse({
      status: "rejected",
      contractVersion: PUBLIC_ANSWER_GROUNDING_CONTRACT_VERSION,
      reasonCode: "support_id_not_selected",
      segmentIndex: 1,
      elapsedMilliseconds: 3,
    })).not.toHaveProperty("text");
    expect(new Set(PUBLIC_ANSWER_GROUNDING_REASON_CODES).size)
      .toBe(PUBLIC_ANSWER_GROUNDING_REASON_CODES.length);
  });

  it("fingerprints every deterministic fallback field that generation cannot own", () => {
    const artifact = createPublicEvidenceArtifact();
    const baseline = new DeterministicPublicAnswerService().answer(artifact, {
      question: "What React systems has Carl built?",
    });
    const snapshot = createPublicAnswerFallbackSnapshot(artifact, baseline);

    expect(PUBLIC_MODEL_MUTABLE_ANSWER_FIELDS).toEqual(["answer"]);
    expect(snapshot).toMatchObject({
      corpusVersion: baseline.corpusVersion,
      corpusHash: artifact.manifest.corpusHash,
      revokedEvidenceIds: [],
      claimIds: baseline.claims.map((claim) => claim.claimId),
      citationEvidenceIds: baseline.citations.map((citation) => citation.evidenceId),
    });
    expect(snapshot.responseDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(snapshot.limitationDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });
});
