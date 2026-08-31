import type { CareerEmbeddingProvider } from "../domain/career-retrieval.js";
import {
  type PublicCareerEvidenceArtifact,
  type PublicCareerEvidenceRecord,
} from "../domain/public-career-evidence.js";
import {
  PUBLIC_PORTFOLIO_ANSWER_LIMITS,
  type PortfolioAnswerRequest,
} from "../domain/public-portfolio-contract.js";
import {
  type PublicEvidenceRetriever,
  isShippedWorkQuestion,
  matchPublicProjectEntityPath,
  selectDeterministicPublicEvidence,
} from "./public-answer-service.js";
import {
  serializePublicEmbeddingEvidence,
  serializePublicEmbeddingQuestion,
} from "./public-model-data.js";

const RRF_K = 60;

export interface HybridPublicEvidenceRetrieverOptions {
  readonly minimumVectorScore?: number;
}

interface CachedPublicCorpusEmbeddings {
  readonly corpusVersion: string;
  readonly records: readonly PublicCareerEvidenceRecord[];
  readonly vectors: readonly (readonly number[])[];
}

/**
 * Hybrid public RAG over the already-approved export only.
 *
 * The small public corpus is embedded once per warm runtime and kept in
 * memory. Reciprocal-rank fusion combines semantic similarity with the
 * deterministic hiring/lexical selector. No private registry, Obsidian note,
 * MCP tool, or raw source is reachable from this boundary.
 */
export class HybridPublicEvidenceRetriever implements PublicEvidenceRetriever {
  readonly #minimumVectorScore: number;
  #cachedCorpus: Promise<CachedPublicCorpusEmbeddings | null> | undefined;
  #cachedCorpusVersion: string | undefined;

  constructor(
    private readonly embeddings: CareerEmbeddingProvider,
    options: HybridPublicEvidenceRetrieverOptions = {},
  ) {
    const minimumVectorScore = options.minimumVectorScore ?? 0.25;
    if (
      !Number.isFinite(minimumVectorScore) ||
      minimumVectorScore < 0 ||
      minimumVectorScore > 1
    ) {
      throw new Error("Public vector threshold must be between zero and one.");
    }
    this.#minimumVectorScore = minimumVectorScore;
  }

  async retrieve(
    artifact: PublicCareerEvidenceArtifact,
    request: PortfolioAnswerRequest,
  ): Promise<readonly PublicCareerEvidenceRecord[]> {
    const deterministic = selectDeterministicPublicEvidence(artifact, request);
    if (isPrivateOrSensitiveQuery(request.question)) return deterministic;
    if (isShippedWorkQuestion(request.question)) return deterministic;
    const projectPath = matchPublicProjectEntityPath(
      artifact.evidence,
      request.question,
    );

    const [corpus, queryEmbeddings] = await Promise.all([
      this.#corpusEmbeddings(artifact),
      safeEmbed(this.embeddings, [serializePublicEmbeddingQuestion(
        request.question,
        new Date().toISOString(),
      )]),
    ]);
    const queryVector = queryEmbeddings?.[0]?.vector;
    if (!corpus || !queryVector) return deterministic;

    const semantic = corpus.records
      .map((record, index) => ({
        record,
        score: cosineSimilarity(corpus.vectors[index] ?? [], queryVector),
      }))
      .filter(({ record, score }) =>
        score >= this.#minimumVectorScore && (
          !projectPath ||
          record.citation.href === projectPath ||
          record.citation.href.startsWith(`${projectPath}#`)
        )
      )
      .sort((left, right) =>
        right.score - left.score ||
        left.record.evidenceId.localeCompare(right.record.evidenceId)
      );
    const deterministicRanks = new Map(
      deterministic.map((record, index) => [record.evidenceId, index + 1]),
    );
    const semanticRanks = new Map(
      semantic.map((item, index) => [item.record.evidenceId, index + 1]),
    );
    const semanticScores = new Map(
      semantic.map((item) => [item.record.evidenceId, item.score]),
    );

    return artifact.evidence
      .map((record) => {
        const deterministicRank = deterministicRanks.get(record.evidenceId);
        const semanticRank = semanticRanks.get(record.evidenceId);
        return {
          record,
          deterministicRank,
          semanticScore: semanticScores.get(record.evidenceId) ?? 0,
          fusedScore:
            (deterministicRank ? 1 / (RRF_K + deterministicRank) : 0) +
            (semanticRank ? 1 / (RRF_K + semanticRank) : 0),
        };
      })
      .filter(({ fusedScore }) => fusedScore > 0)
      .sort((left, right) =>
        right.fusedScore - left.fusedScore ||
        Number(Boolean(right.deterministicRank)) -
          Number(Boolean(left.deterministicRank)) ||
        right.semanticScore - left.semanticScore ||
        left.record.evidenceId.localeCompare(right.record.evidenceId)
      )
      .slice(0, PUBLIC_PORTFOLIO_ANSWER_LIMITS.responseItems)
      .map(({ record }) => record);
  }

  #corpusEmbeddings(
    artifact: PublicCareerEvidenceArtifact,
  ): Promise<CachedPublicCorpusEmbeddings | null> {
    if (
      this.#cachedCorpus &&
      this.#cachedCorpusVersion === artifact.manifest.corpusVersion
    ) {
      return this.#cachedCorpus;
    }
    this.#cachedCorpusVersion = artifact.manifest.corpusVersion;
    this.#cachedCorpus = this.#createCorpusEmbeddings(artifact);
    return this.#cachedCorpus;
  }

  async #createCorpusEmbeddings(
    artifact: PublicCareerEvidenceArtifact,
  ): Promise<CachedPublicCorpusEmbeddings | null> {
    const embeddings = await safeEmbed(
      this.embeddings,
      artifact.evidence.map(serializePublicEmbeddingEvidence),
    );
    if (!embeddings || embeddings.length !== artifact.evidence.length) {
      return null;
    }
    return {
      corpusVersion: artifact.manifest.corpusVersion,
      records: artifact.evidence,
      vectors: embeddings.map(({ vector }) => vector),
    };
  }
}

async function safeEmbed(
  provider: CareerEmbeddingProvider,
  texts: readonly string[],
) {
  if (texts.length === 0) return [];
  try {
    const embeddings = await provider.embed(texts);
    if (
      !embeddings ||
      embeddings.length !== texts.length ||
      embeddings.some(({ vector }) =>
        vector.length === 0 || vector.some((value) => !Number.isFinite(value))
      )
    ) {
      return null;
    }
    return embeddings;
  } catch {
    return null;
  }
}

function cosineSimilarity(
  left: readonly number[],
  right: readonly number[],
): number {
  if (left.length === 0 || left.length !== right.length) return 0;
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }
  if (leftMagnitude === 0 || rightMagnitude === 0) return 0;
  return dot / Math.sqrt(leftMagnitude * rightMagnitude);
}

function isPrivateOrSensitiveQuery(question: string): boolean {
  return /\b(?:private memory|secret|password|system prompt|social security|ssn|home address|phone number|email address|medical|health record|salary|compensation)\b/iu
    .test(question.normalize("NFKC"));
}
