import { z } from "zod";

import type {
  CareerClaim,
  CareerEvidenceStore,
  CareerEvidenceValidationIssue,
  CareerRelationship,
  CareerSource,
} from "../domain/career-evidence.js";

const scopeSchema = z.object({
  actorId: z.string().trim().min(1).max(120),
  workspaceId: z.string().trim().min(1).max(120),
});

const sourceDecisionSchema = scopeSchema.extend({
  id: z.string().trim().min(1).max(240),
  decision: z.enum(["approved", "rejected"]),
  reviewerId: z.string().trim().min(1).max(120),
});

const claimDecisionSchema = scopeSchema.extend({
  id: z.string().uuid(),
  decision: z.enum(["approve_internal", "approve_public", "reject"]),
  reviewerId: z.string().trim().min(1).max(120),
});

const revokeClaimSchema = scopeSchema.extend({
  id: z.string().uuid(),
});

export class CareerEvidenceService {
  constructor(private readonly store: CareerEvidenceStore) {}

  listSources(input: unknown): readonly CareerSource[] {
    return this.store.listSources(scopeSchema.parse(input));
  }

  listClaims(input: unknown): readonly CareerClaim[] {
    return this.store.listClaims(scopeSchema.parse(input));
  }

  listRelationships(input: unknown): readonly CareerRelationship[] {
    return this.store.listRelationships(scopeSchema.parse(input));
  }

  listPublicClaims(input: unknown): readonly CareerClaim[] {
    return this.store.listPublicClaims(scopeSchema.parse(input));
  }

  validate(input: unknown): readonly CareerEvidenceValidationIssue[] {
    return this.store.validate(scopeSchema.parse(input));
  }

  decideSource(input: unknown): CareerSource {
    return this.store.decideSource(sourceDecisionSchema.parse(input));
  }

  decideClaim(input: unknown): CareerClaim {
    return this.store.decideClaim(claimDecisionSchema.parse(input));
  }

  revokeClaim(input: unknown): CareerClaim {
    const request = revokeClaimSchema.parse(input);
    return this.store.revokeClaim(request.id, request);
  }

  revokeSource(input: unknown): CareerSource {
    const request = sourceDecisionSchema
      .pick({ id: true, actorId: true, workspaceId: true })
      .parse(input);
    return this.store.revokeSource(request.id, request);
  }
}
