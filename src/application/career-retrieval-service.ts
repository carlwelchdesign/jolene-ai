import { createHmac, randomBytes } from "node:crypto";

import { z } from "zod";

import type { CareerEvidenceScope } from "../domain/career-evidence.js";
import {
  CareerRetrievalAuthorizationError,
  type CareerKnowledgeSource,
  type CareerRetrievalAuditStore,
  type CareerRetrievalIndex,
  type CareerRetrievalRequestContext,
  type CareerRetrievalResponse,
  type CareerRetrievalSearchRequest,
  type CareerRetrievalSyncReport,
} from "../domain/career-retrieval.js";
import { isPrivateChannel } from "../domain/policy.js";

const querySchema = z.string().trim().min(2).max(1_000);
const limitSchema = z.number().int().min(1).max(8).default(5);
const accessListSchema = z.object({
  actorId: z.string().trim().min(1).max(120),
  workspaceId: z.string().trim().min(1).max(120),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export interface CareerRetrievalServiceOptions {
  readonly index: CareerRetrievalIndex;
  readonly audit: CareerRetrievalAuditStore;
  readonly corpusScope: CareerEvidenceScope;
  readonly allowedActorIds: ReadonlySet<string>;
  readonly fingerprintKey?: Buffer;
}

export class CareerRetrievalService implements CareerKnowledgeSource {
  private readonly fingerprintKey: Buffer;

  constructor(private readonly options: CareerRetrievalServiceOptions) {
    this.fingerprintKey = options.fingerprintKey ?? randomBytes(32);
  }

  canSearch(context: CareerRetrievalRequestContext): boolean {
    return isPrivateChannel(context.channelKind) &&
      this.options.allowedActorIds.has(context.actorId);
  }

  async synchronize(): Promise<CareerRetrievalSyncReport> {
    return this.options.index.synchronize(this.options.corpusScope);
  }

  listAccesses(input: unknown) {
    const request = accessListSchema.parse(input);
    if (
      request.actorId !== this.options.corpusScope.actorId ||
      request.workspaceId !== this.options.corpusScope.workspaceId
    ) return [];
    return this.options.audit.listAccesses(request, request.limit);
  }

  async search(
    request: CareerRetrievalSearchRequest,
  ): Promise<CareerRetrievalResponse> {
    if (!this.canSearch(request.context)) {
      throw new CareerRetrievalAuthorizationError();
    }
    const query = querySchema.parse(request.query);
    const limit = limitSchema.parse(request.limit);
    const queryFingerprint = createHmac("sha256", this.fingerprintKey)
      .update(query.toLowerCase())
      .digest("hex");

    try {
      const response = await this.options.index.search(
        query,
        this.options.corpusScope,
        limit,
      );
      this.options.audit.recordAccess({
        ...request.context,
        corpusActorId: this.options.corpusScope.actorId,
        corpusWorkspaceId: this.options.corpusScope.workspaceId,
        queryFingerprint,
        mode: response.mode,
        status: "completed",
        resultCount: response.results.length,
        errorCode: null,
        citations: response.results.map((result) => ({
          chunkId: result.citation.chunkId,
          sourceId: result.citation.sourceId,
          claimId: result.citation.claimId,
          score: result.score,
        })),
      });
      return response;
    } catch (error) {
      try {
        this.options.audit.recordAccess({
          ...request.context,
          corpusActorId: this.options.corpusScope.actorId,
          corpusWorkspaceId: this.options.corpusScope.workspaceId,
          queryFingerprint,
          mode: null,
          status: "failed",
          resultCount: 0,
          errorCode: classifyError(error),
          citations: [],
        });
      } catch {
        // Evidence is not returned if either retrieval or its audit write fails.
      }
      throw error;
    }
  }
}

function classifyError(error: unknown): string {
  if (error instanceof Error && error.name) {
    return error.name
      .toLowerCase()
      .replaceAll(/[^a-z0-9_-]/g, "_")
      .slice(0, 80);
  }
  return "unknown_error";
}
