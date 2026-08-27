import { z } from "zod";

import type { CapabilityInvocationStore } from
  "../domain/capability-invocation.js";

const listInputSchema = z.object({
  actorId: z.string().trim().min(1).max(120),
  workspaceId: z.string().trim().min(1).max(120),
  eventId: z.string().trim().min(1).max(240).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
}).strict();

export class CapabilityInvocationAuditService {
  constructor(private readonly store: CapabilityInvocationStore) {}

  list(input: unknown) {
    const parsed = listInputSchema.parse(input);
    return this.store.listInvocations({
      actorId: parsed.actorId,
      workspaceId: parsed.workspaceId,
      limit: parsed.limit,
      ...(parsed.eventId ? { eventId: parsed.eventId } : {}),
    });
  }
}
