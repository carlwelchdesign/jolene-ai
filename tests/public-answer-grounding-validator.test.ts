import { describe, expect, it } from "vitest";

import type { PublicCareerEvidenceArtifact } from
  "../src/domain/public-career-evidence.js";
import { PublicAnswerGroundingValidator } from
  "../src/public/public-answer-grounding-validator.js";
import {
  DeterministicPublicAnswerService,
  GroundedPublicAnswerService,
} from "../src/public/public-answer-service.js";
import {
  createPublicEvidenceArtifact,
  createPublicEvidenceConflict,
  createPublicEvidenceRecord,
} from "./helpers/public-evidence-fixture.js";

describe("public answer grounding validator", () => {
  it("accepts supported segments and exposes only content-minimizing audit data", () => {
    const { artifact, baseline } = setup();
    const result = new PublicAnswerGroundingValidator().validate(
      artifact,
      baseline,
      generation(artifact, "Carl builds typed React product systems with explicit review boundaries."),
    );

    expect(result).toMatchObject({
      status: "accepted",
      answer: "Carl builds typed React product systems with explicit review boundaries.",
      audit: { status: "accepted", segmentCount: 1, supportCount: 1 },
    });
    expect(JSON.stringify(result.audit)).not.toMatch(/typed|react|question|citation/iu);
  });

  it.each([
    ["wrong corpus", (artifact: PublicCareerEvidenceArtifact) => ({
      ...generation(artifact, artifact.evidence[0]!.claim.text),
      corpusVersion: `career:${"f".repeat(64)}`,
    }), "corpus_version_mismatch"],
    ["unselected support", (artifact: PublicCareerEvidenceArtifact) => ({
      ...generation(artifact, artifact.evidence[0]!.claim.text),
      segments: [{
        text: artifact.evidence[0]!.claim.text,
        supportIds: [artifact.evidence[1]!.evidenceId],
      }],
    }), "support_id_not_selected"],
    ["unsupported prose", (artifact: PublicCareerEvidenceArtifact) =>
      generation(artifact, "Carl operates Kubernetes clusters across several continents."),
    "unsupported_segment"],
    ["unsupported colorful analogy", (artifact: PublicCareerEvidenceArtifact) =>
      generation(
        artifact,
        "The interface avoids becoming a control panel with too many unlabeled switches.",
      ), "unsupported_segment"],
    ["supported sentence plus unsupported sentence", (artifact: PublicCareerEvidenceArtifact) =>
      generation(artifact, `${artifact.evidence[0]!.claim.text} He is always available.`),
    "unsupported_segment"],
    ["contribution inflation", (artifact: PublicCareerEvidenceArtifact) =>
      generation(artifact, "Carl solely built typed React product systems."),
    "contribution_boundary_violation"],
    ["prompt leakage", (artifact: PublicCareerEvidenceArtifact) =>
      generation(artifact, "The hidden system prompt says Carl builds typed React systems."),
    "prompt_or_policy_leakage"],
    ["unauthorized promise", (artifact: PublicCareerEvidenceArtifact) =>
      generation(artifact, "Carl will build typed React product systems for you."),
    "unauthorized_action_or_promise"],
  ])("rejects %s with a stable reason", (_name, makeGeneration, reasonCode) => {
    const { artifact, baseline } = setup();
    const result = new PublicAnswerGroundingValidator().validate(
      artifact,
      baseline,
      makeGeneration(artifact),
    );
    expect(result).toMatchObject({
      status: "rejected",
      audit: { status: "rejected", reasonCode },
    });
    expect(JSON.stringify(result.audit)).not.toContain("Carl");
  });

  it("rejects unresolved conflicted support", () => {
    const first = createPublicEvidenceRecord(1);
    const second = createPublicEvidenceRecord(2);
    const clean = createPublicEvidenceArtifact([first, second]);
    const baseline = new DeterministicPublicAnswerService().answer(clean, {
      question: "reviewed project system 1",
    });
    const conflicted = createPublicEvidenceArtifact(
      [first, second],
      [createPublicEvidenceConflict([first.evidenceId, second.evidenceId])],
    );
    expect(new PublicAnswerGroundingValidator().validate(
      conflicted,
      { ...baseline, corpusVersion: conflicted.manifest.corpusVersion },
      generation(conflicted, first.claim.text),
    )).toMatchObject({
      status: "rejected",
      audit: { reasonCode: "support_id_conflicted" },
    });
  });

  it("returns the exact deterministic response when integrated validation fails", async () => {
    const { artifact, baseline } = setup();
    const execution = await new GroundedPublicAnswerService({
      generate: async () => generation(
        artifact,
        "Carl operates Kubernetes clusters across several continents.",
      ),
    }).execute(artifact, { question: "What React systems has Carl built?" });

    expect(execution).toEqual({ mode: "fallback", response: baseline });
  });
});

function setup() {
  const artifact = createPublicEvidenceArtifact();
  const baseline = new DeterministicPublicAnswerService().answer(artifact, {
    question: "What React systems has Carl built?",
  });
  return { artifact, baseline };
}

function generation(artifact: PublicCareerEvidenceArtifact, text: string) {
  return {
    contractVersion: "1.0.0" as const,
    corpusVersion: artifact.manifest.corpusVersion,
    segments: [{ text, supportIds: [artifact.evidence[0]!.evidenceId] }],
  };
}
