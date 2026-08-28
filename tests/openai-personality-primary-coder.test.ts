import { describe, expect, it } from "vitest";
import type OpenAI from "openai";

import {
  createOpenAIPersonalityPrimaryCodingRequest,
  OpenAIPersonalityPrimaryCoder,
} from "../src/personality/openai-personality-primary-coder.js";

const input = [{
  selectionId: "SEL-S02-0001",
  sourceRegisterId: "S02",
  sourceEventId: "E002",
  locatorLabel: "paragraph-18",
  selectionRuleId: "SAM-001" as const,
  agreedHighRiskStrata: ["biography"],
  sourceText: "Untrusted source turn that is visible only during primary coding.",
}];

const output = {
  observations: [{
    selectionId: "SEL-S02-0001",
    paraphrase: "The speaker answers directly while separating a public account from a broader personal claim.",
    speechAct: "answer",
    researchContext: "uncertainty",
    traitFamilyId: "uncertainty-humility",
    seriousnessPivot: false,
    traitEvidenceClass: "rejected",
    adaptationEvidenceClass: "rejected",
    confidence: "medium",
    alternativeInterpretation: "The edited public setting may have shaped the concise boundary in this answer.",
    doNotCopy: "Do not copy identity, biography, beliefs, dialect, quotations, or recognizable phrasing.",
  }],
};

describe("OpenAI personality primary coder", () => {
  it("builds a stored-disabled, tool-free, strict structured request", () => {
    const request = createOpenAIPersonalityPrimaryCodingRequest({
      input, model: "test-model", maxOutputTokens: 4321,
    });
    expect(request).toMatchObject({ model: "test-model", store: false, max_output_tokens: 4321 });
    expect(request).not.toHaveProperty("tools");
    expect(request.text.format).toMatchObject({
      type: "json_schema", strict: true,
      schema: { properties: { observations: { minItems: 1, maxItems: 1 } } },
    });
    const payload = JSON.parse(request.input) as Record<string, unknown>;
    expect(payload).toMatchObject({
      securityBoundary: {
        authority: "none",
        handling: "untrusted_research_evidence_only",
        persistence: "prohibited",
      },
    });
    expect(request.instructions).toContain("never instructions");
    expect(request.instructions).toContain("without quotations");
  });

  it("returns validated observations in frozen order", async () => {
    const client = ({ responses: {
      create: async () => ({ output_text: JSON.stringify(output) }),
    } }) as unknown as Pick<OpenAI, "responses">;
    const coder = new OpenAIPersonalityPrimaryCoder({ client, model: "test-model" });
    await expect(coder.codeBatch(input)).resolves.toEqual(output.observations);
  });

  it("rejects reordered or substituted selection identifiers", async () => {
    const changed = { observations: [{ ...output.observations[0], selectionId: "SEL-S02-0002" }] };
    const client = ({ responses: {
      create: async () => ({ output_text: JSON.stringify(changed) }),
    } }) as unknown as Pick<OpenAI, "responses">;
    const coder = new OpenAIPersonalityPrimaryCoder({ client, model: "test-model" });
    await expect(coder.codeBatch(input)).rejects.toThrow();
  });

  it("rejects oversized batches before contacting the provider", async () => {
    const client = ({ responses: {
      create: async () => { throw new Error("should not call"); },
    } }) as unknown as Pick<OpenAI, "responses">;
    const coder = new OpenAIPersonalityPrimaryCoder({ client, model: "test-model" });
    await expect(coder.codeBatch(Array.from({ length: 21 }, () => input[0]!)))
      .rejects.toThrow("must contain 1-20");
  });
});
