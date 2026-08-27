import OpenAI from "openai";

import type {
  CareerEmbedding,
  CareerEmbeddingProvider,
} from "../domain/career-retrieval.js";

const MAX_PUBLIC_EMBEDDING_BATCH = 64;

export class OpenAIPublicEmbeddingProvider implements CareerEmbeddingProvider {
  readonly existingEmbeddingPolicy = "retain" as const;
  readonly #client: Pick<OpenAI, "embeddings">;

  constructor(
    private readonly model: string,
    apiKey: string,
    client?: Pick<OpenAI, "embeddings">,
  ) {
    this.#client = client ?? new OpenAI({ apiKey });
  }

  async embed(texts: readonly string[]): Promise<readonly CareerEmbedding[]> {
    if (texts.length === 0) return [];
    if (texts.length > MAX_PUBLIC_EMBEDDING_BATCH) {
      throw new RangeError(
        `Public embedding batches cannot exceed ${MAX_PUBLIC_EMBEDDING_BATCH} items.`,
      );
    }
    const response = await this.#client.embeddings.create({
      model: this.model,
      input: [...texts],
      encoding_format: "float",
    });
    const ordered = [...response.data].sort((left, right) =>
      left.index - right.index
    );
    if (ordered.length !== texts.length) {
      throw new Error("The public embedding provider returned an incomplete batch.");
    }
    return ordered.map(({ embedding }) => ({
      model: response.model,
      vector: embedding,
    }));
  }
}
