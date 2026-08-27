import type { ChannelKind } from "./conversation.js";
import type {
  CareerClaim,
  CareerEvidenceScope,
  CareerSource,
  CareerVisibility,
} from "./career-evidence.js";

export type CareerRetrievalMode = "hybrid" | "lexical_fallback";

export interface CareerEmbedding {
  readonly model: string;
  readonly vector: readonly number[];
}

export interface CareerEmbeddingProvider {
  embed(texts: readonly string[]): Promise<readonly CareerEmbedding[] | null>;
}

export interface CareerRetrievalChunk {
  readonly id: string;
  readonly actorId: string;
  readonly workspaceId: string;
  readonly sourceId: string;
  readonly claimId: string;
  readonly logicalKey: string;
  readonly sourceTitle: string;
  readonly claimTitle: string;
  readonly content: string;
  readonly contentHash: string;
  readonly maturity: CareerClaim["maturity"];
  readonly visibility: Extract<
    CareerVisibility,
    "internal_approved" | "public_approved"
  >;
  readonly provenanceRef: string | null;
  readonly provenanceUri: string | null;
  readonly sourceLastReviewedAt: string;
  readonly claimLastReviewedAt: string;
  readonly embeddingModel: string | null;
  readonly embedding: readonly number[] | null;
}

export interface CareerRetrievalCitation {
  readonly chunkId: string;
  readonly sourceId: string;
  readonly claimId: string;
  readonly sourceTitle: string;
  readonly claimTitle: string;
  readonly logicalKey: string;
  readonly provenanceRef: string | null;
  readonly provenanceUri: string | null;
  readonly reviewedAt: string;
}

export interface CareerRetrievalResult {
  readonly excerpt: string;
  readonly maturity: CareerClaim["maturity"];
  readonly visibility: Extract<
    CareerVisibility,
    "internal_approved" | "public_approved"
  >;
  readonly score: number;
  readonly lexicalScore: number;
  readonly vectorScore: number;
  readonly citation: CareerRetrievalCitation;
}

export interface CareerRetrievalResponse {
  readonly mode: CareerRetrievalMode;
  readonly results: readonly CareerRetrievalResult[];
}

export interface CareerRetrievalSyncReport {
  readonly eligibleClaimCount: number;
  readonly chunkCount: number;
  readonly embeddedChunkCount: number;
  readonly lexicalOnlyChunkCount: number;
  readonly removedChunkCount: number;
}

export interface CareerRetrievalIndex {
  synchronize(scope: CareerEvidenceScope): Promise<CareerRetrievalSyncReport>;
  search(
    query: string,
    scope: CareerEvidenceScope,
    limit: number,
  ): Promise<CareerRetrievalResponse>;
  close(): void;
}

export interface CareerRetrievalRequestContext {
  readonly eventId: string;
  readonly actorId: string;
  readonly workspaceId: string;
  readonly channelKind: ChannelKind;
  readonly channelId: string;
  readonly threadId: string;
}

export interface CareerRetrievalSearchRequest {
  readonly query: string;
  readonly limit?: number;
  readonly context: CareerRetrievalRequestContext;
}

export interface CareerRetrievalAccessCitation {
  readonly chunkId: string;
  readonly sourceId: string;
  readonly claimId: string;
  readonly score: number;
}

export interface CareerRetrievalAccessRecord {
  readonly id: string;
  readonly eventId: string;
  readonly actorId: string;
  readonly workspaceId: string;
  readonly corpusActorId: string;
  readonly corpusWorkspaceId: string;
  readonly channelKind: ChannelKind;
  readonly channelId: string;
  readonly threadId: string;
  readonly queryFingerprint: string;
  readonly mode: CareerRetrievalMode | null;
  readonly status: "completed" | "failed";
  readonly resultCount: number;
  readonly errorCode: string | null;
  readonly citations: readonly CareerRetrievalAccessCitation[];
  readonly createdAt: string;
}

export interface RecordCareerRetrievalAccessInput {
  readonly eventId: string;
  readonly actorId: string;
  readonly workspaceId: string;
  readonly corpusActorId: string;
  readonly corpusWorkspaceId: string;
  readonly channelKind: ChannelKind;
  readonly channelId: string;
  readonly threadId: string;
  readonly queryFingerprint: string;
  readonly mode: CareerRetrievalMode | null;
  readonly status: "completed" | "failed";
  readonly resultCount: number;
  readonly errorCode: string | null;
  readonly citations: readonly CareerRetrievalAccessCitation[];
}

export interface CareerRetrievalAuditStore {
  recordAccess(
    input: RecordCareerRetrievalAccessInput,
  ): CareerRetrievalAccessRecord;
  listAccesses(
    scope: CareerEvidenceScope,
    limit: number,
  ): readonly CareerRetrievalAccessRecord[];
  close(): void;
}

export interface CareerKnowledgeSource {
  canSearch(context: CareerRetrievalRequestContext): boolean;
  search(request: CareerRetrievalSearchRequest): Promise<CareerRetrievalResponse>;
}

export class CareerRetrievalAuthorizationError extends Error {
  constructor() {
    super("Career evidence retrieval is not authorized for this actor or channel.");
    this.name = "CareerRetrievalAuthorizationError";
  }
}

export function isCareerEvidenceEligible(
  source: CareerSource,
  claim: CareerClaim,
  now: Date,
): boolean {
  if (
    source.state !== "active" ||
    source.reviewState !== "approved" ||
    !source.lastReviewedAt ||
    claim.state !== "active" ||
    claim.reviewState !== "approved" ||
    !claim.lastReviewedAt ||
    (claim.visibility !== "internal_approved" &&
      claim.visibility !== "public_approved")
  ) {
    return false;
  }

  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - 180);
  return new Date(source.lastReviewedAt) >= cutoff &&
    new Date(claim.lastReviewedAt) >= cutoff;
}
