import { describe, expect, it } from "vitest";
import type OpenAI from "openai";

import { OpenAIPublicAnswerGenerator } from
  "../src/public/openai-public-answer-generator.js";

describe("OpenAI public answer generator", () => {
  it("uses a bounded, stored-disabled Responses request with strict JSON output", async () => {
    const calls: unknown[][] = [];
    const client = {
      responses: {
        create: async (...parameters: unknown[]) => {
          calls.push(parameters);
          return { output_text: JSON.stringify({ answer: "Grounded answer." }) };
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
      evidence: [{
        claimText: "Carl built a reviewed product system.",
        limitations: ["Only the claim as written is supported."],
        citationTitle: "Reviewed product system",
      }],
    };

    expect(await generator.generate(input)).toBe("Grounded answer.");
    expect(calls).toHaveLength(1);
    const request = calls[0]?.[0] as Record<string, unknown>;
    expect(request).toMatchObject({
      model: "test-model",
      store: false,
      input: JSON.stringify(input),
      max_output_tokens: 321,
    });
    expect(request).not.toHaveProperty("tools");
    expect(request.text).toMatchObject({
      format: {
        type: "json_schema",
        name: "public_portfolio_answer",
        strict: true,
      },
    });
    expect(calls[0]?.[1]).toMatchObject({ signal: expect.any(AbortSignal) });
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

    await expect(generator.generate({ question: "Question", evidence: [] }))
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
