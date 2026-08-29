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

  it("accepts a supported product claim about email operations without treating it as contact disclosure", () => {
    const record = createPublicEvidenceRecord(1, {
      text: "Job Search OS combines tracking and email operations in one product.",
    });
    const artifact = createPublicEvidenceArtifact([record]);
    const baseline = new DeterministicPublicAnswerService().answerFromSelected(
      artifact,
      { question: "What did Carl build?" },
      [record],
    );

    expect(new PublicAnswerGroundingValidator().validate(
      artifact,
      baseline,
      generation(artifact, record.claim.text),
    )).toMatchObject({ status: "accepted", answer: record.claim.text });
  });

  it("accepts a sourced negative privacy boundary without allowing positive access", () => {
    const record = createPublicEvidenceRecord(1, {
      text: "Public Jolene cannot read Obsidian or private memory.",
    });
    const artifact = createPublicEvidenceArtifact([record]);
    const baseline = new DeterministicPublicAnswerService().answerFromSelected(
      artifact,
      { question: "Can public Jolene read private systems?" },
      [record],
    );
    const validator = new PublicAnswerGroundingValidator();

    expect(validator.validate(
      artifact,
      baseline,
      generation(artifact, record.claim.text),
    )).toMatchObject({ status: "accepted", answer: record.claim.text });
    expect(validator.validate(
      artifact,
      baseline,
      generation(artifact, "Public Jolene reads Obsidian and private memory."),
    )).toMatchObject({
      status: "rejected",
      audit: { reasonCode: "private_or_contact_disclosure" },
    });
  });

  it("accepts separated-runtime and kept-out privacy language from Jolene evidence", () => {
    const runtime = createPublicEvidenceRecord(1, {
      text: "Dockerizes the private runtime as separate API, Slack, and monitoring processes sharing durable SQLite state, while the public delegate uses a different image, state volume, environment, and network boundary.",
    });
    const artifactBoundary = createPublicEvidenceRecord(2, {
      text: "Exports public career knowledge as a versioned, hash-verified, deny-by-default artifact; private evidence and raw Obsidian content never enter that artifact.",
    });
    const artifact = createPublicEvidenceArtifact([runtime, artifactBoundary]);
    const baseline = new DeterministicPublicAnswerService().answerFromSelected(
      artifact,
      { question: "How did Carl separate public and private Jolene?" },
      [runtime, artifactBoundary],
    );

    expect(new PublicAnswerGroundingValidator().validate(artifact, baseline, {
      contractVersion: "1.0.0",
      corpusVersion: artifact.manifest.corpusVersion,
      segments: [
        {
          text: "He split the private runtime into distinct API, Slack, and monitoring processes with durable SQLite state, while the public delegate runs in a different image, state volume, environment, and network boundary.",
          supportIds: [runtime.evidenceId],
        },
        {
          text: "The public artifact is versioned, hash-verified, and deny-by-default, with private evidence and Obsidian content kept out.",
          supportIds: [artifactBoundary.evidenceId],
        },
      ],
    })).toMatchObject({ status: "accepted" });
  });

  it("accepts a conservative project-boundary paraphrase without accepting invention", () => {
    const record = createPublicEvidenceRecord(1, {
      text: "The public chat is deployed as a portfolio demonstration; the broader chief-of-staff runtime remains a private local system for Carl.",
    });
    const artifact = createPublicEvidenceArtifact([record]);
    const baseline = new DeterministicPublicAnswerService().answerFromSelected(
      artifact,
      { question: "How did Carl build Jolene?" },
      [record],
    );
    const validator = new PublicAnswerGroundingValidator();

    expect(validator.validate(artifact, baseline, generation(
      artifact,
      "Carl built Jolene as a private chief-of-staff runtime and a separate public chat demo, not as one shared system.",
    ))).toMatchObject({ status: "accepted" });
    expect(validator.validate(artifact, baseline, generation(
      artifact,
      "Carl built Jolene as an autonomous recruiting system that guarantees hiring outcomes.",
    ))).toMatchObject({ status: "rejected" });
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
    const { artifact } = setup();
    const execution = await new GroundedPublicAnswerService({
      generate: async () => generation(
        artifact,
        "Carl operates Kubernetes clusters across several continents.",
      ),
    }).execute(artifact, { question: "What React systems has Carl built?" });

    expect(execution).toMatchObject({
      mode: "validation_fallback",
      responseKind: "clarification",
      response: { claims: [], citations: [] },
    });
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
