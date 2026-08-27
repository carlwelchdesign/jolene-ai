import OpenAI from "openai";

import type {
  CareerEmbedding,
  CareerEmbeddingProvider,
} from "../domain/career-retrieval.js";

const MAX_BATCH_SIZE = 64;

export function createCareerEmbeddingProvider(
  enabled: boolean,
  model: string,
  apiKey?: string,
): CareerEmbeddingProvider {
  return enabled
    ? new OpenAICareerEmbeddingProvider(model, apiKey)
    : new UnavailableCareerEmbeddingProvider();
}

export class OpenAICareerEmbeddingProvider implements CareerEmbeddingProvider {
  private readonly client: OpenAI;

  constructor(
    private readonly model: string,
    apiKey?: string,
  ) {
    this.client = new OpenAI({ apiKey });
  }

  async embed(texts: readonly string[]): Promise<readonly CareerEmbedding[]> {
    if (texts.length === 0) return [];
    if (texts.length > MAX_BATCH_SIZE) {
      throw new RangeError(`Career embedding batches cannot exceed ${MAX_BATCH_SIZE} items.`);
    }

    const response = await this.client.embeddings.create({
      model: this.model,
      input: [...texts],
      encoding_format: "float",
    });
    const ordered = [...response.data].sort((left, right) => left.index - right.index);
    if (ordered.length !== texts.length) {
      throw new Error("The embedding provider returned an incomplete batch.");
    }

    return ordered.map((item) => ({
      model: response.model,
      vector: item.embedding,
    }));
  }
}

export class UnavailableCareerEmbeddingProvider implements CareerEmbeddingProvider {
  async embed(): Promise<null> {
    return null;
  }
}
