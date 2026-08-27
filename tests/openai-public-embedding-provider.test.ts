import { describe, expect, it } from "vitest";
import type OpenAI from "openai";

import { OpenAIPublicEmbeddingProvider } from
  "../src/public/openai-public-embedding-provider.js";

describe("OpenAIPublicEmbeddingProvider", () => {
  it("requests ordered float embeddings with a bounded batch", async () => {
    const calls: unknown[] = [];
    const client = {
      embeddings: {
        create: async (request: unknown) => {
          calls.push(request);
          return {
            model: "embedding-model",
            data: [
              { index: 1, embedding: [0, 1] },
              { index: 0, embedding: [1, 0] },
            ],
          };
        },
      },
    } as unknown as Pick<OpenAI, "embeddings">;
    const provider = new OpenAIPublicEmbeddingProvider(
      "embedding-model",
      "test-key-not-real",
      client,
    );

    await expect(provider.embed(["first", "second"])).resolves.toEqual([
      { model: "embedding-model", vector: [1, 0] },
      { model: "embedding-model", vector: [0, 1] },
    ]);
    expect(calls).toEqual([{
      model: "embedding-model",
      input: ["first", "second"],
      encoding_format: "float",
    }]);
  });

  it("rejects oversized or incomplete batches", async () => {
    const incompleteClient = {
      embeddings: {
        create: async () => ({ model: "test", data: [] }),
      },
    } as unknown as Pick<OpenAI, "embeddings">;
    const provider = new OpenAIPublicEmbeddingProvider(
      "test",
      "test-key-not-real",
      incompleteClient,
    );

    await expect(provider.embed(["missing"])).rejects.toThrow(/incomplete/i);
    await expect(provider.embed(Array.from({ length: 65 }, () => "x")))
      .rejects.toThrow(/cannot exceed/i);
  });
});
