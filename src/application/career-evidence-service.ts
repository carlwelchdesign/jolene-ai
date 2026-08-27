import { z } from "zod";

import type {
  CareerClaim,
  CareerClaimConflict,
  CareerEvidenceStore,
  CareerEvidenceValidationIssue,
  CareerRelationship,
  CareerSource,
  CareerEvidenceScope,
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

const declareConflictSchema = scopeSchema.extend({
  claimIds: z.array(z.string().uuid()).min(2).max(5),
  reviewerId: z.string().trim().min(1).max(120),
}).strict();

const resolveConflictSchema = scopeSchema.extend({
  id: z.string().regex(/^conflict:[a-f0-9]{16}$/),
  reviewerId: z.string().trim().min(1).max(120),
}).strict();

export class CareerEvidenceService {
  constructor(
    private readonly store: CareerEvidenceStore,
    private readonly authorizedScope: CareerEvidenceScope,
  ) {}

  scope(): CareerEvidenceScope {
    return this.authorizedScope;
  }

  listSources(input: unknown): readonly CareerSource[] {
    return this.store.listSources(this.parseScope(input));
  }

  listClaims(input: unknown): readonly CareerClaim[] {
    return this.store.listClaims(this.parseScope(input));
  }

  listRelationships(input: unknown): readonly CareerRelationship[] {
    return this.store.listRelationships(this.parseScope(input));
  }

  listPublicClaims(input: unknown): readonly CareerClaim[] {
    return this.store.listPublicClaims(this.parseScope(input));
  }

  listClaimConflicts(input: unknown): readonly CareerClaimConflict[] {
    return this.store.listClaimConflicts(this.parseScope(input));
  }

  validate(input: unknown): readonly CareerEvidenceValidationIssue[] {
    return this.store.validate(this.parseScope(input));
  }

  decideSource(input: unknown): CareerSource {
    const request = sourceDecisionSchema.parse(input);
    this.assertAuthorizedScope(request);
    this.assertAuthorizedReviewer(request.reviewerId);
    return this.store.decideSource(request);
  }

  decideClaim(input: unknown): CareerClaim {
    const request = claimDecisionSchema.parse(input);
    this.assertAuthorizedScope(request);
    this.assertAuthorizedReviewer(request.reviewerId);
    return this.store.decideClaim(request);
  }

  revokeClaim(input: unknown): CareerClaim {
    const request = revokeClaimSchema.parse(input);
    this.assertAuthorizedScope(request);
    return this.store.revokeClaim(request.id, request);
  }

  revokeSource(input: unknown): CareerSource {
    const request = sourceDecisionSchema
      .pick({ id: true, actorId: true, workspaceId: true })
      .parse(input);
    this.assertAuthorizedScope(request);
    return this.store.revokeSource(request.id, request);
  }

  declareClaimConflict(input: unknown): CareerClaimConflict {
    const request = declareConflictSchema.parse(input);
    this.assertAuthorizedScope(request);
    this.assertAuthorizedReviewer(request.reviewerId);
    return this.store.declareClaimConflict(request);
  }

  resolveClaimConflict(input: unknown): CareerClaimConflict {
    const request = resolveConflictSchema.parse(input);
    this.assertAuthorizedScope(request);
    this.assertAuthorizedReviewer(request.reviewerId);
    return this.store.resolveClaimConflict(request);
  }

  private parseScope(input: unknown): CareerEvidenceScope {
    const scope = scopeSchema.parse(input);
    this.assertAuthorizedScope(scope);
    return scope;
  }

  private assertAuthorizedScope(scope: CareerEvidenceScope): void {
    if (
      scope.actorId !== this.authorizedScope.actorId ||
      scope.workspaceId !== this.authorizedScope.workspaceId
    ) {
      throw new CareerEvidenceScopeError();
    }
  }

  private assertAuthorizedReviewer(reviewerId: string): void {
    if (reviewerId !== this.authorizedScope.actorId) {
      throw new CareerEvidenceScopeError();
    }
  }
}

export class CareerEvidenceScopeError extends Error {
  constructor() {
    super("Career evidence review is restricted to the configured owner scope.");
    this.name = "CareerEvidenceScopeError";
  }
}
