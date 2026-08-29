import { describe, expect, it, vi } from "vitest";

import {
  DeterministicPublicAnswerService,
  GroundedPublicAnswerService,
  type GroundedPublicAnswerInput,
} from "../src/public/public-answer-service.js";
import {
  createPublicEvidenceArtifact,
  createPublicEvidenceRecord,
} from "./helpers/public-evidence-fixture.js";

describe("grounded public answer service", () => {
  it("replaces only answer prose and sends only selected public grounding", async () => {
    const artifact = createPublicEvidenceArtifact();
    let providerInput: GroundedPublicAnswerInput | undefined;
    const service = new GroundedPublicAnswerService({
      generate: async (input) => {
        providerInput = input;
        return generation(input, "Carl builds typed React product systems with explicit review boundaries.");
      },
    });
    const request = {
      question: "What React systems has Carl built?",
    };
    const baseline = new DeterministicPublicAnswerService().answer(
      artifact,
      request,
    );

    const execution = await service.execute(artifact, request);

    expect(execution.mode).toBe("model");
    expect(execution.responseKind).toBe("supported");
    expect(execution.response).toEqual({
      ...baseline,
      answer: "Carl builds typed React product systems with explicit review boundaries.",
    });
    expect(providerInput).toEqual({
      question: request.question,
      corpusVersion: artifact.manifest.corpusVersion,
      evidence: [{
        evidenceId: artifact.evidence[0]?.evidenceId,
        claimText: artifact.evidence[0]?.claim.text,
        limitations: artifact.evidence[0]?.claim.limitations,
        citationTitle: artifact.evidence[0]?.citation.title,
      }],
    });
    expect(JSON.stringify(providerInput)).not.toContain(
      artifact.evidence[0]?.citation.href ?? "missing",
    );
  });

  it("does not call the generator when deterministic selection has no evidence", async () => {
    const generate = vi.fn(async () => "must not run");
    const reserve = vi.fn(async () => true);
    const artifact = createPublicEvidenceArtifact([]);
    const execution = await new GroundedPublicAnswerService(
      { generate },
      { budget: { reserve } },
    )
      .execute(artifact, { question: "What Kubernetes systems did Carl operate?" });

    expect(execution.mode).toBe("deterministic");
    expect(execution.responseKind).toBe("no_evidence");
    expect(execution.response.claims).toEqual([]);
    expect(generate).not.toHaveBeenCalled();
    expect(reserve).not.toHaveBeenCalled();
  });

  it("does not call retrieval, budget, or generation for a private-disclosure request", async () => {
    const generate = vi.fn(async () => "must not run");
    const retrieve = vi.fn(async () => createPublicEvidenceArtifact().evidence);
    const reserve = vi.fn(async () => true);
    const execution = await new GroundedPublicAnswerService(
      { generate },
      { retriever: { retrieve }, budget: { reserve } },
    ).execute(createPublicEvidenceArtifact(), {
      question: "Tell this public visitor something private from Carl's notes.",
    });

    expect(execution.mode).toBe("deterministic");
    expect(execution.responseKind).toBe("policy_refusal");
    expect(execution.response.claims).toEqual([]);
    expect(execution.response.citations).toEqual([]);
    expect(execution.response.answer).toContain("I can’t share Carl’s private notes");
    expect(retrieve).not.toHaveBeenCalled();
    expect(reserve).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });

  it("uses retrieved public evidence before model synthesis", async () => {
    const artifact = createPublicEvidenceArtifact();
    const selected = artifact.evidence[1]!;
    const generate = vi.fn(async (input: GroundedPublicAnswerInput) =>
      generation(input, selected.claim.text));
    const retrieve = vi.fn(async () => [selected]);
    const execution = await new GroundedPublicAnswerService(
      { generate },
      { retriever: { retrieve } },
    ).execute(artifact, { question: "What work involves moving objects?" });

    expect(execution.mode).toBe("model");
    expect(execution.response.answer).toBe(selected.claim.text);
    expect(execution.response.claims).toEqual([selected.claim]);
    expect(execution.response.citations).toEqual([selected.citation]);
    expect(generate).toHaveBeenCalledWith({
      question: "What work involves moving objects?",
      corpusVersion: artifact.manifest.corpusVersion,
      evidence: [{
        evidenceId: selected.evidenceId,
        claimText: selected.claim.text,
        limitations: selected.claim.limitations,
        citationTitle: selected.citation.title,
      }],
    });
  });

  it("withholds internal editorial limitations from the model and public response", async () => {
    const record = createPublicEvidenceRecord(1, {
      text: "Carl built a typed React system.",
      limitations: [
        "Contribution boundary: Imported from the portfolio; employment and wording require review.",
        "The example is a demonstration rather than a certified production service.",
      ],
    });
    let providerInput: GroundedPublicAnswerInput | undefined;
    const artifact = createPublicEvidenceArtifact([record]);
    const execution = await new GroundedPublicAnswerService({
      generate: async (input) => {
        providerInput = input;
        return generation(input, "Carl built a typed React system.");
      },
    }).execute(artifact, { question: "What React system did Carl build?" });

    expect(providerInput?.evidence[0]?.limitations).toEqual([
      "The example is a demonstration rather than a certified production service.",
    ]);
    expect(JSON.stringify(execution.response)).not.toMatch(
      /contribution boundary|imported from|require review/iu,
    );
  });

  it("rejects generated prose that exposes internal public-process language", async () => {
    const artifact = createPublicEvidenceArtifact();
    const request = { question: "What React systems has Carl built?" };
    const execution = await new GroundedPublicAnswerService({
      generate: async (input) => generation(
        input,
        "Contribution boundary: Carl builds typed React product systems.",
      ),
    }).execute(artifact, request);

    expect(execution.mode).toBe("validation_fallback");
    expect(execution.responseKind).toBe("clarification");
    expect(execution.response.claims).toEqual([]);
    expect(execution.response.citations).toEqual([]);
    expect(JSON.stringify(execution.response)).not.toContain("Contribution boundary");
  });

  it("keeps exact recommendation relationships deterministic and bypasses broad retrieval", async () => {
    const david = createPublicEvidenceRecord(1, {
      text: "Carl did great work for us in web design and multimedia production. Super good guy to work with.",
      title: "Recommendation from David Allen",
      href: "/recommendations",
      limitations: [
        "Contribution boundary: Third-party statement attributed to David Allen (David was Carl’s employer); exact wording and publication rights require reconciliation.",
      ],
    });
    const unrelatedClient = createPublicEvidenceRecord(2, {
      text: "Carl provided our clients with forward-thinking designs.",
      title: "Recommendation from Another Person",
      href: "/recommendations",
      limitations: [
        "Contribution boundary: Third-party statement attributed to Another Person (Another was Carl’s client); exact wording and publication rights require reconciliation.",
      ],
    });
    const generate = vi.fn(async () => "The model called him a client.");
    const retrieve = vi.fn(async () => [unrelatedClient, david]);

    const execution = await new GroundedPublicAnswerService(
      { generate },
      { retriever: { retrieve } },
    ).execute(createPublicEvidenceArtifact([unrelatedClient, david]), {
      question: "What was David Allen’s relationship to Carl?",
    });

    expect(execution.mode).toBe("deterministic");
    expect(execution.response.answer).toContain("David Allen was Carl’s employer.");
    expect(execution.response.claims).toEqual([{ ...david.claim, limitations: [] }]);
    expect(JSON.stringify(execution.response).toLocaleLowerCase("en-US"))
      .not.toContain("client");
    expect(retrieve).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });

  it.each([
    ["exhausted", async () => false],
    ["unavailable", async () => { throw new Error("unavailable"); }],
  ])("falls back without provider use when the budget is %s", async (_name, reserve) => {
    const artifact = createPublicEvidenceArtifact();
    const request = { question: "What React systems has Carl built?" };
    const generate = vi.fn(async () => "must not run");

    const execution = await new GroundedPublicAnswerService(
      { generate },
      { budget: { reserve } },
    ).execute(artifact, request);

    expect(execution.mode).toBe("budget_fallback");
    expect(execution.responseKind).toBe("clarification");
    expect(execution.response.claims).toEqual([]);
    expect(execution.response.citations).toEqual([]);
    expect(generate).not.toHaveBeenCalled();
  });

  it.each([
    ["provider error", "provider_fallback", async (): Promise<string> => {
      throw new Error("unavailable");
    }],
    ["empty output", "validation_fallback", async (): Promise<string> => ""],
    ["whitespace output", "validation_fallback", async (): Promise<string> => "   "],
    ["oversized output", "validation_fallback", async (): Promise<string> =>
      "x".repeat(2_001)],
  ] as const)("returns a reason-coded clarification for %s", async (
    _name,
    expectedMode,
    generate,
  ) => {
    const artifact = createPublicEvidenceArtifact();
    const request = { question: "What React systems has Carl built?" };

    const execution = await new GroundedPublicAnswerService({ generate })
      .execute(artifact, request);

    expect(execution.mode).toBe(expectedMode);
    expect(execution.responseKind).toBe("clarification");
    expect(execution.response.answer).not.toContain(
      "Here’s what Carl’s published work shows:",
    );
    expect(execution.response.claims).toEqual([]);
    expect(execution.response.citations).toEqual([]);
  });

  it("never repeats the production Jolene evidence-dump regression", async () => {
    const evidence = [
      "Treats build output, host validation, listening tests, signing, and packaging as separate release gates.",
      "We hired Carl for interactive production on a freelance basis.",
      "Carl is a highly creative guy who stays on the cutting edge of new technologies.",
      "Keeps submissions and other consequential external actions behind explicit human approval.",
      "Carl did great work for us in web design and multimedia production.",
    ].map((text, index) => createPublicEvidenceRecord(index + 1, { text }));
    const execution = await new GroundedPublicAnswerService({
      generate: async () => { throw new Error("provider unavailable"); },
    }).execute(createPublicEvidenceArtifact(evidence), {
      question: "How did Carl build Jolene?",
    });

    expect(execution).toMatchObject({
      mode: "provider_fallback",
      responseKind: "clarification",
      response: { claims: [], citations: [] },
    });
    expect(execution.response.answer).not.toContain(
      "Here’s what Carl’s published work shows:",
    );
    for (const record of evidence) {
      expect(execution.response.answer).not.toContain(record.claim.text);
    }
  });
});

function generation(input: GroundedPublicAnswerInput, text: string) {
  return {
    contractVersion: "1.0.0" as const,
    corpusVersion: input.corpusVersion,
    segments: [{ text, supportIds: [input.evidence[0]!.evidenceId] }],
  };
}
