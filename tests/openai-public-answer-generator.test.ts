import { describe, expect, it } from "vitest";
import type OpenAI from "openai";

import { OpenAIPublicAnswerGenerator } from
  "../src/public/openai-public-answer-generator.js";

const corpusVersion = `career:${"a".repeat(64)}`;
const evidenceId = "career:00000000-0000-4000-8000-000000000001";

function groundedOutput(answer = "Grounded answer.") {
  return {
    contractVersion: "1.0.0" as const,
    corpusVersion,
    segments: [{ text: answer, supportIds: [evidenceId] }],
  };
}

function emptyInput() {
  return { question: "Question", corpusVersion, evidence: [] };
}

describe("OpenAI public answer generator", () => {
  it("uses a bounded, stored-disabled Responses request with strict JSON output", async () => {
    const calls: unknown[][] = [];
    const client = {
      responses: {
        create: async (...parameters: unknown[]) => {
          calls.push(parameters);
          return { output_text: JSON.stringify(groundedOutput()) };
        },
      },
    } as unknown as Pick<OpenAI, "responses">;
    const generator = new OpenAIPublicAnswerGenerator({
      client,
      model: "test-model",
      timeoutMilliseconds: 2_000,
      maxOutputTokens: 321,
    });
    const input = {
      question: "What has Carl built?",
      corpusVersion,
      evidence: [{
        evidenceId,
        claimText: "Carl built a reviewed product system.",
        limitations: ["Only the claim as written is supported."],
        citationTitle: "Reviewed product system",
      }],
    };

    expect(await generator.generate(input)).toEqual(groundedOutput());
    expect(calls).toHaveLength(1);
    const request = calls[0]?.[0] as Record<string, unknown>;
    expect(request).toMatchObject({
      model: "test-model",
      store: false,
      max_output_tokens: 321,
    });
    const modelInput = JSON.parse(String(request.input)) as {
      securityBoundary: { authority: string; handling: string };
      question: { kind: string; text: string };
      evidence: Array<{ kind: string; evidenceId: string }>;
    };
    expect(modelInput.securityBoundary).toMatchObject({
      authority: "none",
      handling: "untrusted_data_only",
    });
    expect(modelInput.question).toEqual({
      kind: "untrusted_public_question",
      text: input.question,
    });
    expect(modelInput.evidence).toEqual([
      expect.objectContaining({
        kind: "reviewed_public_evidence",
        evidenceId,
      }),
    ]);
    expect(String(request.input)).not.toContain("private/path");
    expect(request).not.toHaveProperty("tools");
    expect(request.instructions).toEqual(expect.stringContaining(
      "Lead with the direct answer",
    ));
    expect(request.instructions).toEqual(expect.stringContaining(
      "Synthesize the evidence",
    ));
    expect(request.instructions).toEqual(expect.stringContaining(
      "do not reflexively turn them into praise",
    ));
    expect(request.instructions).toEqual(expect.stringContaining(
      "not evidence that weaknesses do not exist",
    ));
    expect(request.instructions).toEqual(expect.stringContaining(
      "not a press release",
    ));
    expect(request.instructions).toEqual(expect.stringContaining(
      "credible role-fit risks or unknowns",
    ));
    expect(request.instructions).toEqual(expect.not.stringContaining(
      "Dolly Parton",
    ));
    expect(request.text).toMatchObject({
      format: {
        type: "json_schema",
        name: "public_portfolio_grounded_answer",
        strict: true,
      },
    });
    expect(calls[0]?.[1]).toMatchObject({ signal: expect.any(AbortSignal) });
  });

  it("returns validated provider usage for explicit live measurement", async () => {
    const client = {
      responses: {
        create: async () => ({
          output_text: JSON.stringify(groundedOutput()),
          model: "test-model",
          usage: {
            input_tokens: 120,
            output_tokens: 30,
            total_tokens: 150,
            input_tokens_details: {},
            output_tokens_details: {},
          },
        }),
      },
    } as unknown as Pick<OpenAI, "responses">;
    const generator = new OpenAIPublicAnswerGenerator({
      client,
      model: "test-model",
      timeoutMilliseconds: 2_000,
    });

    await expect(generator.generateMeasured(emptyInput()))
      .resolves.toEqual({
        answer: "Grounded answer.",
        groundedGeneration: groundedOutput(),
        model: "test-model",
        inputTokens: 120,
        outputTokens: 30,
        totalTokens: 150,
      });
  });

  it("rejects missing or inconsistent usage only for measured generation", async () => {
    const missingUsageClient = {
      responses: {
        create: async () => ({
          output_text: JSON.stringify(groundedOutput()),
        }),
      },
    } as unknown as Pick<OpenAI, "responses">;
    const generator = new OpenAIPublicAnswerGenerator({
      client: missingUsageClient,
      model: "test-model",
      timeoutMilliseconds: 2_000,
    });

    await expect(generator.generate(emptyInput()))
      .resolves.toEqual(groundedOutput());
    await expect(generator.generateMeasured(emptyInput()))
      .rejects.toBeDefined();

    const inconsistentUsageClient = {
      responses: {
        create: async () => ({
          output_text: JSON.stringify(groundedOutput()),
          usage: {
            input_tokens: 120,
            output_tokens: 30,
            total_tokens: 100,
          },
        }),
      },
    } as unknown as Pick<OpenAI, "responses">;
    await expect(new OpenAIPublicAnswerGenerator({
      client: inconsistentUsageClient,
      model: "test-model",
      timeoutMilliseconds: 2_000,
    }).generateMeasured(emptyInput()))
      .rejects.toBeDefined();
  });

  it.each([
    ["malformed JSON", "not-json"],
    ["empty answer", JSON.stringify({ answer: "" })],
    ["extra output field", JSON.stringify({ answer: "Okay", extra: true })],
  ])("rejects %s for the grounded service to handle", async (_name, outputText) => {
    const client = {
      responses: { create: async () => ({ output_text: outputText }) },
    } as unknown as Pick<OpenAI, "responses">;
    const generator = new OpenAIPublicAnswerGenerator({
      client,
      model: "test-model",
      timeoutMilliseconds: 2_000,
    });

    await expect(generator.generate(emptyInput()))
      .rejects.toBeDefined();
  });

  it("rejects invalid runtime bounds", () => {
    const client = {
      responses: { create: async () => ({ output_text: "{}" }) },
    } as unknown as Pick<OpenAI, "responses">;
    expect(() => new OpenAIPublicAnswerGenerator({
      client,
      model: "test-model",
      timeoutMilliseconds: 0,
    })).toThrow();
    expect(() => new OpenAIPublicAnswerGenerator({
      client,
      model: "test-model",
      timeoutMilliseconds: 1,
      maxOutputTokens: 0,
    })).toThrow();
  });
});
