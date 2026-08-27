import { describe, expect, it, vi } from "vitest";

import type { CareerEmbeddingProvider } from
  "../src/domain/career-retrieval.js";
import { HybridPublicEvidenceRetriever } from
  "../src/public/public-hybrid-evidence-retriever.js";
import {
  createPublicEvidenceArtifact,
  createPublicEvidenceRecord,
} from "./helpers/public-evidence-fixture.js";

describe("HybridPublicEvidenceRetriever", () => {
  it("retrieves a semantic match when there is no shared lexical term", async () => {
    const artifact = createPublicEvidenceArtifact([
      createPublicEvidenceRecord(1, {
        title: "Frontend systems",
        text: "Carl built typed product interfaces.",
      }),
      createPublicEvidenceRecord(2, {
        title: "Audio products",
        text: "Carl built host-loadable audio plugins.",
      }),
    ]);
    const provider = new StubEmbeddingProvider(
      [[1, 0], [0, 1]],
      [0.99, 0.01],
    );

    const result = await new HybridPublicEvidenceRetriever(provider).retrieve(
      artifact,
      { question: "interface specialist" },
    );

    expect(result[0]?.evidenceId).toBe(artifact.evidence[0]?.evidenceId);
  });

  it("combines deterministic hiring selection with semantic ranking", async () => {
    const artifact = createPublicEvidenceArtifact([
      createPublicEvidenceRecord(1, {
        title: "Technical leadership",
        text: "Carl led frontend delivery and mentored engineers.",
      }),
      createPublicEvidenceRecord(2, {
        title: "Senior Software Engineer at Example",
        text: "Carl built shared product interfaces.",
      }),
    ]);
    const provider = new StubEmbeddingProvider(
      [[0, 1], [1, 0]],
      [1, 0],
    );

    const result = await new HybridPublicEvidenceRetriever(provider).retrieve(
      artifact,
      { question: "Why shouldn't I hire Carl?" },
    );

    expect(result).toHaveLength(2);
    expect(new Set(result.map(({ evidenceId }) => evidenceId))).toEqual(
      new Set(artifact.evidence.map(({ evidenceId }) => evidenceId)),
    );
  });

  it("caches corpus embeddings per version while embedding each query", async () => {
    const artifact = createPublicEvidenceArtifact([
      createPublicEvidenceRecord(1),
    ]);
    const embed = vi.fn(async (texts: readonly string[]) =>
      texts.map(() => ({ model: "test", vector: [1, 0] }))
    );
    const retriever = new HybridPublicEvidenceRetriever({ embed });

    await retriever.retrieve(artifact, { question: "first question" });
    await retriever.retrieve(artifact, { question: "second question" });

    expect(embed).toHaveBeenCalledTimes(3);
    expect(embed.mock.calls.filter(([texts]) => texts.length > 1)).toHaveLength(0);
    expect(embed.mock.calls.filter(([texts]) => texts[0]?.includes("Reviewed project")))
      .toHaveLength(1);
  });

  it("does not send private or sensitive queries to embeddings", async () => {
    const embed = vi.fn(async () => [{ model: "test", vector: [1, 0] }]);
    const result = await new HybridPublicEvidenceRetriever({ embed }).retrieve(
      createPublicEvidenceArtifact(),
      { question: "What is Carl's home address?" },
    );

    expect(result).toEqual([]);
    expect(embed).not.toHaveBeenCalled();
  });

  it("falls back to deterministic selection when embeddings fail", async () => {
    const artifact = createPublicEvidenceArtifact();
    const provider: CareerEmbeddingProvider = { embed: async () => null };
    const result = await new HybridPublicEvidenceRetriever(provider).retrieve(
      artifact,
      { question: "What React systems has Carl built?" },
    );

    expect(result[0]?.evidenceId).toBe(artifact.evidence[0]?.evidenceId);
  });
});

class StubEmbeddingProvider implements CareerEmbeddingProvider {
  constructor(
    private readonly corpusVectors: readonly (readonly number[])[],
    private readonly queryVector: readonly number[],
  ) {}

  async embed(texts: readonly string[]) {
    const vectors = texts.length === this.corpusVectors.length
      ? this.corpusVectors
      : texts.map(() => this.queryVector);
    return vectors.map((vector) => ({ model: "test", vector }));
  }
}
