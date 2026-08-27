import { describe, expect, it } from "vitest";

import {
  createCareerEmbeddingProvider,
  OpenAICareerEmbeddingProvider,
  UnavailableCareerEmbeddingProvider,
} from "../src/knowledge/openai-career-embeddings.js";

describe("career embedding provider selection", () => {
  it("uses the network-free provider while embeddings are disabled", async () => {
    const provider = createCareerEmbeddingProvider(
      false,
      "text-embedding-3-small",
    );

    expect(provider).toBeInstanceOf(UnavailableCareerEmbeddingProvider);
    await expect(provider.embed(["private evidence"])).resolves.toBeNull();
  });

  it("constructs the OpenAI adapter only after explicit opt-in", () => {
    const provider = createCareerEmbeddingProvider(
      true,
      "text-embedding-3-small",
      "test-key",
    );

    expect(provider).toBeInstanceOf(OpenAICareerEmbeddingProvider);
  });
});
