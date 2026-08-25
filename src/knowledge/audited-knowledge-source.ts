import { createHmac, randomBytes } from "node:crypto";

import type { KnowledgeAccessStore } from "../domain/knowledge-audit.js";
import type {
  KnowledgeResult,
  KnowledgeSearchContext,
  KnowledgeSource,
} from "./knowledge-source.js";

export class AuditedKnowledgeSource implements KnowledgeSource {
  constructor(
    private readonly source: KnowledgeSource,
    private readonly audit: KnowledgeAccessStore,
    private readonly fingerprintKey: Buffer = randomBytes(32),
  ) {}

  async search(
    query: string,
    context: KnowledgeSearchContext,
    limit?: number,
  ): Promise<KnowledgeResult[]> {
    const queryFingerprint = createHmac("sha256", this.fingerprintKey)
      .update(query.trim().toLowerCase())
      .digest("hex");

    try {
      const results = await this.source.search(query, context, limit);
      this.audit.recordAccess({
        ...auditScope(context),
        queryFingerprint,
        status: "completed",
        resultCount: results.length,
        errorCode: null,
        citations: results.map(({ notePath, heading, modifiedAt, score }) => ({
          notePath,
          heading,
          modifiedAt,
          score,
        })),
      });
      return results;
    } catch (error) {
      try {
        this.audit.recordAccess({
          ...auditScope(context),
          queryFingerprint,
          status: "failed",
          resultCount: 0,
          errorCode: classifyError(error),
          citations: [],
        });
      } catch {
        // No private note content is returned when either retrieval or auditing fails.
      }
      throw error;
    }
  }
}

function auditScope(context: KnowledgeSearchContext) {
  return {
    eventId: context.eventId,
    actorId: context.actorId,
    workspaceId: context.workspaceId,
    channelKind: context.channelKind,
    channelId: context.channelId,
    threadId: context.threadId,
  };
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
