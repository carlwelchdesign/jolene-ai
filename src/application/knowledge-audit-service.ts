import { z } from "zod";

import type {
  KnowledgeAccessRecord,
  KnowledgeAccessStore,
} from "../domain/knowledge-audit.js";

const listKnowledgeAccessesSchema = z.object({
  actorId: z.string().trim().min(1).max(120),
  workspaceId: z.string().trim().min(1).max(120),
  eventId: z.string().trim().min(1).max(240).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export class KnowledgeAuditService {
  constructor(private readonly store: KnowledgeAccessStore) {}

  listAccesses(input: unknown): readonly KnowledgeAccessRecord[] {
    const request = listKnowledgeAccessesSchema.parse(input);
    return this.store.listAccesses({
      actorId: request.actorId,
      workspaceId: request.workspaceId,
      limit: request.limit,
      ...(request.eventId ? { eventId: request.eventId } : {}),
    });
  }
}
