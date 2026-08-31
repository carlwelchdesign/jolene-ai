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

  it("allows bounded presentation and drops an invalid optional opener without losing grounded substance", () => {
    const { artifact, baseline } = setup();
    const validator = new PublicAnswerGroundingValidator();
    expect(validator.validate(artifact, baseline, {
      ...generation(artifact, "Carl builds typed React product systems with explicit review boundaries."),
      presentation: "Now, the gears start dancing.",
    })).toMatchObject({
      status: "accepted",
      answer: "Now, the gears start dancing.\n\nCarl builds typed React product systems with explicit review boundaries.",
    });
    expect(validator.validate(artifact, baseline, {
      ...generation(artifact, "Carl builds typed React product systems with explicit review boundaries."),
      presentation: "Carl built this with React.",
    })).toMatchObject({
      status: "accepted",
      answer: "Carl builds typed React product systems with explicit review boundaries.",
      audit: { status: "accepted", segmentCount: 1, supportCount: 1 },
    });
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

  it("accepts led as a grounded inflection of leading or leadership", () => {
    const record = createPublicEvidenceRecord(1, {
      text: "Leading frontend delivery, modernizing systems, and mentoring engineers.",
      title: "Technical leadership",
    });
    const artifact = createPublicEvidenceArtifact([record]);
    const baseline = new DeterministicPublicAnswerService().answerFromSelected(
      artifact,
      { question: "Why hire Carl?" },
      [record],
    );

    expect(new PublicAnswerGroundingValidator().validate(
      artifact,
      baseline,
      generation(artifact, "Carl led frontend delivery and mentored engineers."),
    )).toMatchObject({ status: "accepted" });
  });

  it("accepts a conversational paraphrase with one-third material-term coverage", () => {
    const record = createPublicEvidenceRecord(1, {
      text: "Carl led frontend delivery and mentored engineers across complex product teams.",
      title: "Technical leadership",
    });
    const artifact = createPublicEvidenceArtifact([record]);
    const baseline = new DeterministicPublicAnswerService().answerFromSelected(
      artifact,
      { question: "What makes Carl valuable to a product team?" },
      [record],
    );

    expect(new PublicAnswerGroundingValidator().validate(
      artifact,
      baseline,
      generation(
        artifact,
        "Carl brings frontend leadership and mentoring to complex product work, helping teams make sharper decisions together.",
      ),
    )).toMatchObject({ status: "accepted" });
  });

  it("accepts the grounded Army-to-early-web career fragment returned in production", () => {
    const record = createPublicEvidenceRecord(1, {
      text: "Carl's career spans more than 20 years owning customer-facing SaaS, enterprise workflows, internal tools, mobile experiences, analytics products, and interactive applications from product definition through release; after U.S. Army service, his 1994 to 2001 work at Marketing Resource Group, SPi, University OnLine, SAIC, OneSoft, and 9th Insight crossed art direction, code, multimedia, information architecture, team leadership, and client delivery.",
      title: "More than 20 years: Army service and early full-stack delivery",
      href: "/experience#career-foundations",
      maturity: "production",
    });
    const artifact = createPublicEvidenceArtifact([record]);
    const baseline = new DeterministicPublicAnswerService().answerFromSelected(
      artifact,
      { question: "Walk me through Carl's career and work experience." },
      [record],
    );
    const text = "Army service, his 1994 to 2001 work at Marketing Resource Group, SPi, University OnLine, SAIC, OneSoft, and 9th Insight spanned art direction, code, multimedia, information architecture, team leadership, and client delivery.";

    expect(new PublicAnswerGroundingValidator().validate(
      artifact,
      baseline,
      generation(artifact, text),
    )).toMatchObject({ status: "accepted", answer: text });
  });

  it("drops one unsupported model sentence while keeping the grounded sentence", () => {
    const { artifact, baseline } = setup();
    const claim = artifact.evidence[0]!.claim.text;

    expect(new PublicAnswerGroundingValidator().validate(
      artifact,
      baseline,
      generation(artifact, `${claim} He is always available.`),
    )).toMatchObject({
      status: "accepted",
      answer: claim,
      audit: { status: "accepted", segmentCount: 1, supportCount: 1 },
    });
  });

  it("backfills selected evidence the model omitted with the source claim", () => {
    const first = createPublicEvidenceRecord(1, {
      text: "Carl shipped customer-facing SaaS products.",
    });
    const second = createPublicEvidenceRecord(2, {
      text: "Carl managed a VR lab and built spatial training tools.",
    });
    const artifact = createPublicEvidenceArtifact([first, second]);
    const baseline = new DeterministicPublicAnswerService().answerFromSelected(
      artifact,
      { question: "Walk me through Carl's career." },
      [first, second],
    );

    expect(new PublicAnswerGroundingValidator().validate(
      artifact,
      baseline,
      generation(artifact, first.claim.text),
    )).toMatchObject({
      status: "accepted",
      answer: `${first.claim.text}\n\n${second.claim.text}`,
      audit: { status: "accepted", segmentCount: 1, supportCount: 1 },
    });
  });

  it("normalizes several supported sentences into separately validated segments", () => {
    const { artifact, baseline } = setup();
    const claim = artifact.evidence[0]!.claim.text;
    const result = new PublicAnswerGroundingValidator().validate(
      artifact,
      baseline,
      generation(
        artifact,
        `${claim} Carl's typed React product systems keep review boundaries explicit.`,
      ),
    );

    expect(result).toMatchObject({
      status: "accepted",
      answer: `${claim} Carl's typed React product systems keep review boundaries explicit.`,
      audit: { status: "accepted", segmentCount: 2, supportCount: 2 },
    });
  });

  it("discards a punctuation-only model segment without weakening factual validation", () => {
    const { artifact, baseline } = setup();
    const supported = generation(artifact, artifact.evidence[0]!.claim.text);
    const result = new PublicAnswerGroundingValidator().validate(
      artifact,
      baseline,
      {
        ...supported,
        segments: [
          ...supported.segments,
          { text: "—", supportIds: supported.segments[0]!.supportIds },
        ],
      },
    );

    expect(result).toMatchObject({
      status: "accepted",
      answer: artifact.evidence[0]!.claim.text,
      audit: { status: "accepted", segmentCount: 1, supportCount: 1 },
    });
  });

  it("validates nine material sentences normalized from eight provider segments", () => {
    const { artifact, baseline } = setup();
    const claim = artifact.evidence[0]!.claim.text;
    const supportIds = [artifact.evidence[0]!.evidenceId];
    const result = new PublicAnswerGroundingValidator().validate(
      artifact,
      baseline,
      {
        ...generation(artifact, claim),
        segments: Array.from({ length: 8 }, (_, index) => ({
          text: index === 0
            ? `${claim} Carl's typed React product systems keep review boundaries explicit.`
            : claim,
          supportIds,
        })),
      },
    );

    expect(result).toMatchObject({
      status: "accepted",
      audit: { status: "accepted", segmentCount: 9, supportCount: 9 },
    });
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

    expect(execution).toEqual({
      mode: "validation_fallback",
      responseKind: "supported",
      response: baseline,
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
