import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import type { CareerEvidenceStore } from "../domain/career-evidence.js";
import {
  isCareerEvidenceEligible,
  type CareerEmbedding,
  type CareerEmbeddingProvider,
  type CareerRetrievalChunk,
  type CareerRetrievalIndex,
  type CareerRetrievalResponse,
  type CareerRetrievalResult,
  type CareerRetrievalSyncReport,
} from "../domain/career-retrieval.js";
import type { CareerEvidenceScope } from "../domain/career-evidence.js";

interface ChunkRow {
  readonly id: string;
  readonly actor_id: string;
  readonly workspace_id: string;
  readonly source_id: string;
  readonly claim_id: string;
  readonly logical_key: string;
  readonly source_title: string;
  readonly claim_title: string;
  readonly content: string;
  readonly content_hash: string;
  readonly maturity: CareerRetrievalChunk["maturity"];
  readonly visibility: CareerRetrievalChunk["visibility"];
  readonly provenance_ref: string | null;
  readonly provenance_uri: string | null;
  readonly source_last_reviewed_at: string;
  readonly claim_last_reviewed_at: string;
  readonly embedding_model: string | null;
  readonly embedding_json: string | null;
  readonly updated_at: string;
}

interface RankedChunk {
  readonly chunk: CareerRetrievalChunk;
  readonly lexicalScore: number;
  readonly vectorScore: number;
  readonly score: number;
}

const MAX_CHUNK_CHARACTERS = 1_600;
const MAX_EMBEDDING_BATCH = 64;
const RRF_K = 60;

export class SqliteCareerRetrievalIndex implements CareerRetrievalIndex {
  private readonly database: Database.Database;

  constructor(
    databasePath: string,
    private readonly evidence: CareerEvidenceStore,
    private readonly embeddings: CareerEmbeddingProvider,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (databasePath !== ":memory:") {
      fs.mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });
    }
    this.database = new Database(databasePath);
    this.database.pragma("journal_mode = WAL");
    this.database.pragma("foreign_keys = ON");
    this.migrate();
  }

  async synchronize(scope: CareerEvidenceScope): Promise<CareerRetrievalSyncReport> {
    const sources = new Map(
      this.evidence.listSources(scope).map((source) => [source.id, source]),
    );
    const eligibleClaims = this.evidence.listClaims(scope).filter((claim) => {
      const source = sources.get(claim.sourceId);
      return source
        ? isCareerEvidenceEligible(source, claim, this.now())
        : false;
    });
    const desiredChunks = eligibleClaims.flatMap((claim) => {
      const source = sources.get(claim.sourceId);
      return source ? buildChunks(source, claim) : [];
    });
    const existing = new Map(
      this.listChunks(scope).map((chunk) => [chunk.id, chunk]),
    );
    const embeddings = await this.embedChangedChunks(desiredChunks, existing);
    const activeIds = new Set(desiredChunks.map((chunk) => chunk.id));
    const now = this.now().toISOString();
    const upsert = this.database.prepare(
      `INSERT INTO career_retrieval_chunks
        (id, actor_id, workspace_id, source_id, claim_id, logical_key,
         source_title, claim_title, content, content_hash, maturity, visibility,
         provenance_ref, provenance_uri, source_last_reviewed_at,
         claim_last_reviewed_at, embedding_model, embedding_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         source_id = excluded.source_id,
         claim_id = excluded.claim_id,
         logical_key = excluded.logical_key,
         source_title = excluded.source_title,
         claim_title = excluded.claim_title,
         content = excluded.content,
         content_hash = excluded.content_hash,
         maturity = excluded.maturity,
         visibility = excluded.visibility,
         provenance_ref = excluded.provenance_ref,
         provenance_uri = excluded.provenance_uri,
         source_last_reviewed_at = excluded.source_last_reviewed_at,
         claim_last_reviewed_at = excluded.claim_last_reviewed_at,
         embedding_model = excluded.embedding_model,
         embedding_json = excluded.embedding_json,
         updated_at = excluded.updated_at
       WHERE actor_id = excluded.actor_id AND workspace_id = excluded.workspace_id`,
    );
    const remove = this.database.prepare(
      `DELETE FROM career_retrieval_chunks
       WHERE id = ? AND actor_id = ? AND workspace_id = ?`,
    );
    let removedChunkCount = 0;

    this.database.transaction(() => {
      for (const chunk of desiredChunks) {
        const current = existing.get(chunk.id);
        const generated = embeddings.get(chunk.id);
        const reusable =
          this.embeddings.existingEmbeddingPolicy !== "purge" &&
            current?.contentHash === chunk.contentHash
          ? current
          : null;
        const embeddingModel = generated?.model ?? reusable?.embeddingModel ?? null;
        const vector = generated?.vector ?? reusable?.embedding ?? null;
        upsert.run(
          chunk.id,
          chunk.actorId,
          chunk.workspaceId,
          chunk.sourceId,
          chunk.claimId,
          chunk.logicalKey,
          chunk.sourceTitle,
          chunk.claimTitle,
          chunk.content,
          chunk.contentHash,
          chunk.maturity,
          chunk.visibility,
          chunk.provenanceRef,
          chunk.provenanceUri,
          chunk.sourceLastReviewedAt,
          chunk.claimLastReviewedAt,
          embeddingModel,
          vector ? JSON.stringify(vector) : null,
          now,
        );
      }
      for (const current of existing.values()) {
        if (!activeIds.has(current.id)) {
          removedChunkCount += remove.run(
            current.id,
            scope.actorId,
            scope.workspaceId,
          ).changes;
        }
      }
    })();

    const retained = this.listChunks(scope);
    return {
      eligibleClaimCount: eligibleClaims.length,
      chunkCount: retained.length,
      embeddedChunkCount: retained.filter((chunk) => chunk.embedding).length,
      lexicalOnlyChunkCount: retained.filter((chunk) => !chunk.embedding).length,
      removedChunkCount,
    };
  }

  async search(
    query: string,
    scope: CareerEvidenceScope,
    limit: number,
  ): Promise<CareerRetrievalResponse> {
    await this.synchronize(scope);
    const chunks = this.listChunks(scope);
    const terms = tokenize(query);
    const queryEmbedding = await safeEmbed(this.embeddings, [query]);
    const queryVector = queryEmbedding?.[0]?.vector ?? null;
    const lexical = chunks
      .map((chunk) => ({ chunk, score: lexicalScore(chunk, terms) }))
      .filter(({ score }) => score > 0)
      .sort(scoreThenId);
    const vector = queryVector
      ? chunks
          .map((chunk) => ({
            chunk,
            score: chunk.embedding
              ? Math.max(0, cosineSimilarity(chunk.embedding, queryVector))
              : 0,
          }))
          .filter(({ score }) => score > 0)
          .sort(scoreThenId)
      : [];
    const lexicalRanks = new Map(
      lexical.map((item, index) => [item.chunk.id, index + 1]),
    );
    const vectorRanks = new Map(
      vector.map((item, index) => [item.chunk.id, index + 1]),
    );
    const lexicalScores = new Map(lexical.map((item) => [item.chunk.id, item.score]));
    const vectorScores = new Map(vector.map((item) => [item.chunk.id, item.score]));
    const ranked = chunks
      .map((chunk): RankedChunk => {
        const lexicalRank = lexicalRanks.get(chunk.id);
        const vectorRank = vectorRanks.get(chunk.id);
        return {
          chunk,
          lexicalScore: lexicalScores.get(chunk.id) ?? 0,
          vectorScore: vectorScores.get(chunk.id) ?? 0,
          score: (lexicalRank ? 1 / (RRF_K + lexicalRank) : 0) +
            (vectorRank ? 1 / (RRF_K + vectorRank) : 0),
        };
      })
      .filter((item) => item.score > 0)
      .sort((left, right) =>
        right.score - left.score ||
        right.lexicalScore - left.lexicalScore ||
        right.vectorScore - left.vectorScore ||
        left.chunk.id.localeCompare(right.chunk.id)
      );

    return {
      mode: queryVector ? "hybrid" : "lexical_fallback",
      results: dedupeClaims(ranked)
        .slice(0, Math.max(1, Math.min(limit, 8)))
        .map(mapResult),
    };
  }

  close(): void {
    this.database.close();
  }

  private listChunks(scope: CareerEvidenceScope): CareerRetrievalChunk[] {
    return (this.database.prepare(
      `SELECT * FROM career_retrieval_chunks
       WHERE actor_id = ? AND workspace_id = ? ORDER BY id ASC`,
    ).all(scope.actorId, scope.workspaceId) as ChunkRow[]).map(mapChunk);
  }

  private async embedChangedChunks(
    desired: readonly CareerRetrievalChunk[],
    existing: ReadonlyMap<string, CareerRetrievalChunk>,
  ): Promise<ReadonlyMap<string, CareerEmbedding>> {
    const changed = desired.filter((chunk) => {
      const current = existing.get(chunk.id);
      return current?.contentHash !== chunk.contentHash || !current.embedding;
    });
    const generated = new Map<string, CareerEmbedding>();
    for (let offset = 0; offset < changed.length; offset += MAX_EMBEDDING_BATCH) {
      const batch = changed.slice(offset, offset + MAX_EMBEDDING_BATCH);
      const results = await safeEmbed(
        this.embeddings,
        batch.map((chunk) => chunk.content),
      );
      if (!results || results.length !== batch.length) continue;
      batch.forEach((chunk, index) => {
        const result = results[index];
        if (result) generated.set(chunk.id, result);
      });
    }
    return generated;
  }

  private migrate(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS career_retrieval_chunks (
        id TEXT PRIMARY KEY,
        actor_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        claim_id TEXT NOT NULL,
        logical_key TEXT NOT NULL,
        source_title TEXT NOT NULL,
        claim_title TEXT NOT NULL,
        content TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        maturity TEXT NOT NULL,
        visibility TEXT NOT NULL CHECK(visibility IN ('internal_approved', 'public_approved')),
        provenance_ref TEXT,
        provenance_uri TEXT,
        source_last_reviewed_at TEXT NOT NULL,
        claim_last_reviewed_at TEXT NOT NULL,
        embedding_model TEXT,
        embedding_json TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS career_retrieval_chunks_scope
        ON career_retrieval_chunks(actor_id, workspace_id, visibility, claim_id);
    `);
  }
}

function buildChunks(
  source: ReturnType<CareerEvidenceStore["listSources"]>[number],
  claim: ReturnType<CareerEvidenceStore["listClaims"]>[number],
): CareerRetrievalChunk[] {
  if (!source.lastReviewedAt || !claim.lastReviewedAt) return [];
  if (
    claim.visibility !== "internal_approved" &&
    claim.visibility !== "public_approved"
  ) return [];
  const visibility = claim.visibility;

  const sections = [
    `Claim: ${claim.title}`,
    claim.proposition,
    claim.contribution ? `Carl's contribution: ${claim.contribution}` : "",
    `Source: ${source.title}`,
    source.metadata.tags.length > 0
      ? `Tags: ${source.metadata.tags.join(", ")}`
      : "",
  ].filter(Boolean);
  const contentChunks = chunkParagraphs(sections);
  return contentChunks.map((content, index) => ({
    id: `career:${claim.id}:${index}`,
    actorId: claim.actorId,
    workspaceId: claim.workspaceId,
    sourceId: source.id,
    claimId: claim.id,
    logicalKey: claim.logicalKey,
    sourceTitle: source.title,
    claimTitle: claim.title,
    content,
    contentHash: createHash("sha256").update(content).digest("hex"),
    maturity: claim.maturity,
    visibility,
    provenanceRef: source.provenanceRef,
    provenanceUri: source.provenanceUri,
    sourceLastReviewedAt: source.lastReviewedAt!,
    claimLastReviewedAt: claim.lastReviewedAt!,
    embeddingModel: null,
    embedding: null,
  }));
}

function chunkParagraphs(paragraphs: readonly string[]): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    const pieces = splitLongText(paragraph, MAX_CHUNK_CHARACTERS);
    for (const piece of pieces) {
      const candidate = current ? `${current}\n\n${piece}` : piece;
      if (candidate.length <= MAX_CHUNK_CHARACTERS) {
        current = candidate;
      } else {
        if (current) chunks.push(current);
        current = piece;
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function splitLongText(text: string, maximum: number): string[] {
  if (text.length <= maximum) return [text];
  const words = text.split(/\s+/);
  const pieces: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maximum) {
      current = candidate;
    } else {
      if (current) pieces.push(current);
      current = word.slice(0, maximum);
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

async function safeEmbed(
  provider: CareerEmbeddingProvider,
  texts: readonly string[],
): Promise<readonly CareerEmbedding[] | null> {
  try {
    const results = await provider.embed(texts);
    if (!results) return null;
    if (results.some((result) =>
      result.vector.length === 0 ||
      result.vector.some((value) => !Number.isFinite(value))
    )) return null;
    return results;
  } catch {
    return null;
  }
}

function mapChunk(row: ChunkRow): CareerRetrievalChunk {
  return {
    id: row.id,
    actorId: row.actor_id,
    workspaceId: row.workspace_id,
    sourceId: row.source_id,
    claimId: row.claim_id,
    logicalKey: row.logical_key,
    sourceTitle: row.source_title,
    claimTitle: row.claim_title,
    content: row.content,
    contentHash: row.content_hash,
    maturity: row.maturity,
    visibility: row.visibility,
    provenanceRef: row.provenance_ref,
    provenanceUri: row.provenance_uri,
    sourceLastReviewedAt: row.source_last_reviewed_at,
    claimLastReviewedAt: row.claim_last_reviewed_at,
    embeddingModel: row.embedding_model,
    embedding: parseVector(row.embedding_json),
  };
}

function parseVector(value: string | null): readonly number[] | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      Array.isArray(parsed) &&
      parsed.length > 0 &&
      parsed.every((item) => typeof item === "number" && Number.isFinite(item))
    ) return parsed;
  } catch {
    return null;
  }
  return null;
}

function tokenize(query: string): readonly string[] {
  return Array.from(new Set(
    query.toLowerCase().match(/[a-z0-9][a-z0-9+#._-]*/g)
      ?.filter((term) => term.length >= 2) ?? [],
  )).slice(0, 24);
}

function lexicalScore(
  chunk: CareerRetrievalChunk,
  terms: readonly string[],
): number {
  if (terms.length === 0) return 0;
  const title = `${chunk.claimTitle} ${chunk.sourceTitle}`.toLowerCase();
  const body = chunk.content.toLowerCase();
  const key = chunk.logicalKey.toLowerCase();
  return terms.reduce((score, term) =>
    score + countOccurrences(title, term) * 4 +
      countOccurrences(key, term) * 3 +
      countOccurrences(body, term), 0);
}

function countOccurrences(text: string, term: string): number {
  let count = 0;
  let offset = 0;
  while ((offset = text.indexOf(term, offset)) !== -1) {
    count += 1;
    offset += term.length;
  }
  return count;
}

function cosineSimilarity(
  left: readonly number[],
  right: readonly number[],
): number {
  if (left.length === 0 || left.length !== right.length) return 0;
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  left.forEach((value, index) => {
    const other = right[index] ?? 0;
    dot += value * other;
    leftMagnitude += value * value;
    rightMagnitude += other * other;
  });
  const denominator = Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude);
  return denominator > 0 ? dot / denominator : 0;
}

function scoreThenId(
  left: { readonly chunk: CareerRetrievalChunk; readonly score: number },
  right: { readonly chunk: CareerRetrievalChunk; readonly score: number },
): number {
  return right.score - left.score || left.chunk.id.localeCompare(right.chunk.id);
}

function dedupeClaims(items: readonly RankedChunk[]): RankedChunk[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.chunk.claimId)) return false;
    seen.add(item.chunk.claimId);
    return true;
  });
}

function mapResult(item: RankedChunk): CareerRetrievalResult {
  const chunk = item.chunk;
  return {
    excerpt: chunk.content,
    maturity: chunk.maturity,
    visibility: chunk.visibility,
    score: item.score,
    lexicalScore: item.lexicalScore,
    vectorScore: item.vectorScore,
    citation: {
      chunkId: chunk.id,
      sourceId: chunk.sourceId,
      claimId: chunk.claimId,
      sourceTitle: chunk.sourceTitle,
      claimTitle: chunk.claimTitle,
      logicalKey: chunk.logicalKey,
      provenanceRef: chunk.provenanceRef,
      provenanceUri: chunk.provenanceUri,
      reviewedAt: chunk.claimLastReviewedAt,
    },
  };
}
