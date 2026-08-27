import { describe, expect, it, vi } from "vitest";

import {
  DeterministicPublicAnswerService,
  GroundedPublicAnswerService,
  type GroundedPublicAnswerInput,
} from "../src/public/public-answer-service.js";
import { createPublicEvidenceArtifact } from "./helpers/public-evidence-fixture.js";

describe("grounded public answer service", () => {
  it("replaces only answer prose and sends only selected public grounding", async () => {
    const artifact = createPublicEvidenceArtifact();
    let providerInput: GroundedPublicAnswerInput | undefined;
    const service = new GroundedPublicAnswerService({
      generate: async (input) => {
        providerInput = input;
        return "Carl has reviewed evidence of typed React product-system work.";
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
    expect(execution.response).toEqual({
      ...baseline,
      answer: "Carl has reviewed evidence of typed React product-system work.",
    });
    expect(providerInput).toEqual({
      question: request.question,
      evidence: [{
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
    expect(execution.response.claims).toEqual([]);
    expect(generate).not.toHaveBeenCalled();
    expect(reserve).not.toHaveBeenCalled();
  });

  it.each([
    ["exhausted", async () => false],
    ["unavailable", async () => { throw new Error("unavailable"); }],
  ])("falls back without provider use when the budget is %s", async (_name, reserve) => {
    const artifact = createPublicEvidenceArtifact();
    const request = { question: "What React systems has Carl built?" };
    const baseline = new DeterministicPublicAnswerService().answer(artifact, request);
    const generate = vi.fn(async () => "must not run");

    const execution = await new GroundedPublicAnswerService(
      { generate },
      { budget: { reserve } },
    ).execute(artifact, request);

    expect(execution).toEqual({ mode: "budget_fallback", response: baseline });
    expect(generate).not.toHaveBeenCalled();
  });

  it.each([
    ["provider error", async () => { throw new Error("unavailable"); }],
    ["empty output", async () => ""],
    ["whitespace output", async () => "   "],
    ["oversized output", async () => "x".repeat(2_001)],
  ])("falls back exactly to deterministic output for %s", async (_name, generate) => {
    const artifact = createPublicEvidenceArtifact();
    const request = { question: "What React systems has Carl built?" };
    const baseline = new DeterministicPublicAnswerService().answer(artifact, request);

    const execution = await new GroundedPublicAnswerService({ generate })
      .execute(artifact, request);

    expect(execution).toEqual({ mode: "fallback", response: baseline });
  });
});
