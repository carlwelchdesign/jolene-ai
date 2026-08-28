import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import {
  CareerEvidenceApprovalError,
  CareerEvidenceConflictError,
  CareerEvidenceNotFoundError,
  careerRelationshipCandidateFingerprint,
  careerRelationshipCandidateId,
  careerClaimConflictId,
  careerEntityKindSchema,
  careerMaturitySchema,
  careerRelationshipKindSchema,
  careerRelationshipReviewDecisionSchema,
  reviewedCareerRelationshipId,
  careerSourceTypeSchema,
  careerVisibilitySchema,
  type CareerClaim,
  type CareerClaimConflict,
  type CareerEntityKind,
  type CareerEvidenceScope,
  type CareerEvidenceStore,
  type CareerEvidenceValidationIssue,
  type CareerMaturity,
  type CareerRecordState,
  type CareerRelationship,
  type CareerRelationshipCandidate,
  type CareerRelationshipKind,
  type CareerRelationshipReview,
  type CareerRelationshipReviewDecision,
  type CareerSource,
  type CareerSourceMetadata,
  type CareerSourceState,
  type CareerSourceType,
  type CareerVisibility,
  type DecideCareerClaimInput,
  type DecideCareerRelationshipCandidateInput,
  type DecideCareerSourceInput,
  type DeclareCareerClaimConflictInput,
  type EvidenceReviewState,
  type ResolveCareerClaimConflictInput,
  type UpsertCareerClaimInput,
  type UpsertCareerRelationshipInput,
  type UpsertCareerSourceInput,
} from "../domain/career-evidence.js";

interface SourceRow {
  readonly id: string;
  readonly actor_id: string;
  readonly workspace_id: string;
  readonly source_type: CareerSourceType;
  readonly title: string;
  readonly provenance_ref: string | null;
  readonly provenance_uri: string | null;
  readonly source_hash: string;
  readonly captured_at: string;
  readonly metadata_json: string;
  readonly review_state: EvidenceReviewState;
  readonly reviewed_by: string | null;
  readonly last_reviewed_at: string | null;
  readonly state: CareerSourceState;
  readonly created_at: string;
  readonly updated_at: string;
}

interface ClaimRow {
  readonly id: string;
  readonly actor_id: string;
  readonly workspace_id: string;
  readonly source_id: string;
  readonly logical_key: string;
  readonly title: string;
  readonly proposition: string;
  readonly contribution: string;
  readonly maturity: CareerMaturity;
  readonly visibility: CareerVisibility;
  readonly review_state: EvidenceReviewState;
  readonly reviewed_by: string | null;
  readonly last_reviewed_at: string | null;
  readonly supersedes_claim_id: string | null;
  readonly state: CareerRecordState;
  readonly created_at: string;
  readonly updated_at: string;
}

interface RelationshipRow {
  readonly id: string;
  readonly actor_id: string;
  readonly workspace_id: string;
  readonly source_id: string;
  readonly claim_id: string | null;
  readonly from_kind: CareerEntityKind;
  readonly from_id: string;
  readonly relationship: CareerRelationshipKind;
  readonly to_kind: CareerEntityKind;
  readonly to_id: string;
  readonly state: "active" | "revoked";
  readonly created_at: string;
  readonly updated_at: string;
}

interface ClaimConflictRow {
  readonly id: string;
  readonly actor_id: string;
  readonly workspace_id: string;
  readonly claim_ids_json: string;
  readonly state: "unresolved" | "resolved";
  readonly reviewed_by: string;
  readonly resolved_by: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

interface RelationshipReviewRow {
  readonly id: string;
  readonly actor_id: string;
  readonly workspace_id: string;
  readonly candidate_id: string;
  readonly candidate_fingerprint: string;
  readonly claim_id: string;
  readonly source_relationship_id: string;
  readonly decision: CareerRelationshipReviewDecision;
  readonly reviewed_by: string;
  readonly reviewed_at: string;
}

const REVIEW_MAX_AGE_DAYS = 180;
const RELATIONSHIP_REVIEW_PRIORITY: Readonly<Record<CareerRelationshipKind, number>> = {
  employed_by: 0,
  held_role: 1,
  contributed_to: 2,
  demonstrates: 3,
  uses_skill: 4,
  supports: 5,
  in_domain: 6,
  related_to: 7,
};

export interface SqliteCareerEvidenceStoreOptions {
  readonly readOnly?: boolean;
}

export class SqliteCareerEvidenceStore implements CareerEvidenceStore {
  private readonly database: Database.Database;

  constructor(
    databasePath: string,
    private readonly now: () => Date = () => new Date(),
    options: SqliteCareerEvidenceStoreOptions = {},
  ) {
    const readOnly = options.readOnly ?? false;
    if (databasePath !== ":memory:" && !readOnly) {
      fs.mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });
    }
    this.database = new Database(
      databasePath,
      readOnly ? { readonly: true, fileMustExist: true } : undefined,
    );
    if (readOnly) {
      this.database.pragma("query_only = ON");
    } else {
      this.database.pragma("journal_mode = WAL");
    }
    this.database.pragma("foreign_keys = ON");
    if (!readOnly) this.migrate();
  }

  runInTransaction<T>(operation: () => T): T {
    return this.database.transaction(operation)();
  }

  upsertSource(input: UpsertCareerSourceInput): CareerSource {
    assertSourceInput(input);
    const current = this.findSource(input.id, input.actorId, input.workspaceId);
    const now = this.now().toISOString();
    const capturedAt = normalizeTimestamp(input.capturedAt, "capturedAt");
    const metadataJson = JSON.stringify(normalizeSourceMetadata(input.metadata));

    if (!current) {
      this.database.prepare(
        `INSERT INTO career_sources
          (id, actor_id, workspace_id, source_type, title, provenance_ref,
           provenance_uri, source_hash, captured_at, metadata_json, review_state, state,
           created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'needs_review', 'active', ?, ?)`,
      ).run(
        input.id,
        input.actorId,
        input.workspaceId,
        input.sourceType,
        input.title,
        input.provenanceRef,
        input.provenanceUri,
        input.sourceHash,
        capturedAt,
        metadataJson,
        now,
        now,
      );
      return this.requireSource(input.id, input.actorId, input.workspaceId);
    }

    const contentChanged = current.sourceHash !== input.sourceHash ||
      current.title !== input.title ||
      current.sourceType !== input.sourceType ||
      current.provenanceRef !== input.provenanceRef ||
      current.provenanceUri !== input.provenanceUri ||
      JSON.stringify(current.metadata) !== metadataJson;

    if (contentChanged || current.state === "missing") {
      const update = this.database.transaction(() => {
        this.database.prepare(
          `UPDATE career_sources
           SET source_type = ?, title = ?, provenance_ref = ?, provenance_uri = ?,
               source_hash = ?, captured_at = ?, metadata_json = ?,
               review_state = 'needs_review', reviewed_by = NULL,
               last_reviewed_at = NULL,
               state = CASE WHEN state = 'missing' THEN 'active' ELSE state END,
               updated_at = ?
           WHERE id = ? AND actor_id = ? AND workspace_id = ?`,
        ).run(
          input.sourceType,
          input.title,
          input.provenanceRef,
          input.provenanceUri,
          input.sourceHash,
          capturedAt,
          metadataJson,
          now,
          input.id,
          input.actorId,
          input.workspaceId,
        );
        this.revokeReviewedRelationshipsForSource(
          input.id,
          input,
          now,
        );
      });
      update();
    } else if (
      current.state === "active" &&
      new Date(capturedAt) > new Date(current.capturedAt)
    ) {
      this.database.prepare(
        `UPDATE career_sources SET captured_at = ?, updated_at = ?
         WHERE id = ? AND actor_id = ? AND workspace_id = ?`,
      ).run(
        capturedAt,
        now,
        input.id,
        input.actorId,
        input.workspaceId,
      );
    }

    return this.requireSource(input.id, input.actorId, input.workspaceId);
  }

  markSourceMissing(id: string, scope: CareerEvidenceScope): CareerSource {
    const source = this.requireSource(id, scope.actorId, scope.workspaceId);
    if (source.state !== "active") return source;
    const now = this.now().toISOString();
    const update = this.database.transaction(() => {
      this.database.prepare(
        `UPDATE career_sources
         SET state = 'missing', review_state = 'needs_review', reviewed_by = NULL,
             last_reviewed_at = NULL, updated_at = ?
         WHERE id = ? AND actor_id = ? AND workspace_id = ? AND state = 'active'`,
      ).run(now, id, scope.actorId, scope.workspaceId);
      this.revokeReviewedRelationshipsForSource(id, scope, now);
    });
    update();
    return this.requireSource(id, scope.actorId, scope.workspaceId);
  }

  supersedeClaimsNotInSource(
    sourceId: string,
    activeLogicalKeys: readonly string[],
    scope: CareerEvidenceScope,
  ): number {
    this.requireSource(sourceId, scope.actorId, scope.workspaceId);
    const activeKeys = new Set(activeLogicalKeys);
    const activeClaims = this.listClaims(scope).filter(
      (claim) => claim.sourceId === sourceId && claim.state === "active",
    );
    const retire = this.database.prepare(
      `UPDATE career_claims SET state = 'superseded', updated_at = ?
       WHERE id = ? AND actor_id = ? AND workspace_id = ? AND state = 'active'`,
    );
    const now = this.now().toISOString();
    let retired = 0;
    const transaction = this.database.transaction(() => {
      for (const claim of activeClaims) {
        if (!activeKeys.has(claim.logicalKey)) {
          retired += retire.run(
            now,
            claim.id,
            scope.actorId,
            scope.workspaceId,
          ).changes;
          this.revokeReviewedRelationshipsForClaim(claim.id, scope, now);
        }
      }
    });
    transaction();
    return retired;
  }

  revokeRelationshipsNotInSource(
    sourceId: string,
    activeRelationshipIds: readonly string[],
    scope: CareerEvidenceScope,
  ): number {
    this.requireSource(sourceId, scope.actorId, scope.workspaceId);
    const activeIds = new Set(activeRelationshipIds);
    const relationships = this.listRelationships(scope).filter(
      (relationship) =>
        relationship.sourceId === sourceId &&
        relationship.claimId === null &&
        relationship.state === "active",
    );
    const revoke = this.database.prepare(
      `UPDATE career_relationships SET state = 'revoked', updated_at = ?
       WHERE id = ? AND actor_id = ? AND workspace_id = ? AND state = 'active'`,
    );
    const now = this.now().toISOString();
    let revoked = 0;
    const transaction = this.database.transaction(() => {
      for (const relationship of relationships) {
        if (!activeIds.has(relationship.id)) {
          revoked += revoke.run(
            now,
            relationship.id,
            scope.actorId,
            scope.workspaceId,
          ).changes;
          this.revokeReviewedRelationshipsForSourceRelationship(
            relationship.id,
            scope,
            now,
          );
        }
      }
    });
    transaction();
    return revoked;
  }

  upsertDraftClaim(input: UpsertCareerClaimInput): CareerClaim {
    assertClaimInput(input);
    this.requireSource(input.sourceId, input.actorId, input.workspaceId);
    const visibility = input.visibility ?? "public_candidate";
    const current = this.findActiveClaim(
      input.sourceId,
      input.logicalKey,
      input.actorId,
      input.workspaceId,
    );

    if (current && claimMatches(current, input, visibility)) return current;

    const create = this.database.transaction((): CareerClaim => {
      const id = randomUUID();
      const now = this.now().toISOString();
      if (current) {
        this.database.prepare(
          `UPDATE career_claims
           SET state = 'superseded', updated_at = ?
           WHERE id = ? AND state = 'active'`,
        ).run(now, current.id);
        this.revokeReviewedRelationshipsForClaim(current.id, input, now);
      }
      this.database.prepare(
        `INSERT INTO career_claims
          (id, actor_id, workspace_id, source_id, logical_key, title,
           proposition, contribution, maturity, visibility, review_state,
           supersedes_claim_id, state, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'needs_review', ?, 'active', ?, ?)`,
      ).run(
        id,
        input.actorId,
        input.workspaceId,
        input.sourceId,
        input.logicalKey,
        input.title,
        input.proposition,
        input.contribution,
        input.maturity,
        visibility,
        current?.id ?? null,
        now,
        now,
      );

      return this.requireClaim(id, input.actorId, input.workspaceId);
    });

    return create();
  }

  decideSource(input: DecideCareerSourceInput): CareerSource {
    const source = this.requireSource(input.id, input.actorId, input.workspaceId);
    if (source.state !== "active") {
      throw new CareerEvidenceConflictError("A revoked source cannot be reviewed.");
    }
    if (
      input.decision === "approved" &&
      !source.provenanceRef &&
      !source.provenanceUri
    ) {
      throw new CareerEvidenceApprovalError([
        sourceIssue(
          source.id,
          "source_missing_provenance",
          "Source approval requires a provenance reference.",
        ),
      ]);
    }
    const now = this.now().toISOString();
    this.database.prepare(
      `UPDATE career_sources
       SET review_state = ?, reviewed_by = ?, last_reviewed_at = ?, updated_at = ?
       WHERE id = ? AND actor_id = ? AND workspace_id = ?`,
    ).run(
      input.decision,
      requireText(input.reviewerId, "reviewerId"),
      now,
      now,
      input.id,
      input.actorId,
      input.workspaceId,
    );
    return this.requireSource(input.id, input.actorId, input.workspaceId);
  }

  decideClaim(input: DecideCareerClaimInput): CareerClaim {
    const claim = this.requireClaim(input.id, input.actorId, input.workspaceId);
    if (claim.state !== "active") {
      throw new CareerEvidenceConflictError("Only an active claim can be reviewed.");
    }
    const now = this.now().toISOString();
    const visibility = input.decision === "approve_public"
      ? "public_approved"
      : input.decision === "approve_internal"
        ? "internal_approved"
        : claim.visibility === "private"
          ? "private"
          : "public_candidate";
    const reviewState = input.decision === "reject" ? "rejected" : "approved";

    if (input.decision !== "reject") {
      const issues = this.validateClaimForApproval(
        claim,
        input.decision === "approve_public",
      );
      if (issues.length > 0) throw new CareerEvidenceApprovalError(issues);
    }

    this.database.prepare(
      `UPDATE career_claims
       SET visibility = ?, review_state = ?, reviewed_by = ?,
           last_reviewed_at = ?, updated_at = ?
       WHERE id = ? AND actor_id = ? AND workspace_id = ?`,
    ).run(
      visibility,
      reviewState,
      requireText(input.reviewerId, "reviewerId"),
      now,
      now,
      input.id,
      input.actorId,
      input.workspaceId,
    );
    return this.requireClaim(input.id, input.actorId, input.workspaceId);
  }

  approvePublicEvidenceBatch(input: CareerEvidenceScope & {
    readonly sourceIds: readonly string[];
    readonly claimIds: readonly string[];
    readonly reviewerId: string;
  }): void {
    this.runInTransaction(() => {
      for (const id of [...new Set(input.sourceIds)]) {
        this.decideSource({ ...input, id, decision: "approved" });
      }
      for (const id of [...new Set(input.claimIds)]) {
        this.decideClaim({ ...input, id, decision: "approve_public" });
      }
    });
  }

  revokeSource(id: string, scope: CareerEvidenceScope): CareerSource {
    const source = this.requireSource(id, scope.actorId, scope.workspaceId);
    if (source.state === "revoked") return source;
    const now = this.now().toISOString();
    const revoke = this.database.transaction(() => {
      this.database.prepare(
        `UPDATE career_sources SET state = 'revoked', updated_at = ?
         WHERE id = ? AND actor_id = ? AND workspace_id = ?`,
      ).run(now, id, scope.actorId, scope.workspaceId);
      this.revokeReviewedRelationshipsForSource(id, scope, now);
    });
    revoke();
    return this.requireSource(id, scope.actorId, scope.workspaceId);
  }

  revokeClaim(id: string, scope: CareerEvidenceScope): CareerClaim {
    const claim = this.requireClaim(id, scope.actorId, scope.workspaceId);
    if (claim.state === "revoked") return claim;
    if (claim.state === "superseded") {
      throw new CareerEvidenceConflictError("A superseded claim cannot be revoked as the current claim.");
    }
    const now = this.now().toISOString();
    const revoke = this.database.transaction(() => {
      this.database.prepare(
        `UPDATE career_claims SET state = 'revoked', updated_at = ?
         WHERE id = ? AND actor_id = ? AND workspace_id = ?`,
      ).run(now, id, scope.actorId, scope.workspaceId);
      this.revokeReviewedRelationshipsForClaim(id, scope, now);
    });
    revoke();
    return this.requireClaim(id, scope.actorId, scope.workspaceId);
  }

  upsertRelationship(input: UpsertCareerRelationshipInput): CareerRelationship {
    assertRelationshipInput(input);
    this.requireSource(input.sourceId, input.actorId, input.workspaceId);
    if (input.claimId) {
      this.requireClaim(input.claimId, input.actorId, input.workspaceId);
    }
    const now = this.now().toISOString();
    const current = this.listRelationships(input).find(
      (relationship) => relationship.id === input.id,
    );
    const changedSourceRelationship = current?.claimId === null &&
      (
        current.sourceId !== input.sourceId ||
        input.claimId !== null ||
        current.fromKind !== input.fromKind ||
        current.fromId !== input.fromId ||
        current.relationship !== input.relationship ||
        current.toKind !== input.toKind ||
        current.toId !== input.toId ||
        current.state !== "active"
      );
    const upsert = this.database.transaction(() => {
      if (changedSourceRelationship) {
        this.revokeReviewedRelationshipsForSourceRelationship(
          input.id,
          input,
          now,
        );
      }
      this.database.prepare(
      `INSERT INTO career_relationships
        (id, actor_id, workspace_id, source_id, claim_id, from_kind, from_id,
         relationship, to_kind, to_id, state, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         source_id = excluded.source_id,
         claim_id = excluded.claim_id,
         from_kind = excluded.from_kind,
         from_id = excluded.from_id,
         relationship = excluded.relationship,
         to_kind = excluded.to_kind,
         to_id = excluded.to_id,
         state = 'active',
         updated_at = excluded.updated_at
       WHERE actor_id = excluded.actor_id AND workspace_id = excluded.workspace_id`,
      ).run(
        input.id,
        input.actorId,
        input.workspaceId,
        input.sourceId,
        input.claimId,
        input.fromKind,
        input.fromId,
        input.relationship,
        input.toKind,
        input.toId,
        now,
        now,
      );
    });
    upsert();
    return this.requireRelationship(input.id, input.actorId, input.workspaceId);
  }

  decideRelationshipCandidate(
    input: DecideCareerRelationshipCandidateInput,
  ): CareerRelationshipCandidate {
    requireText(input.id, "id");
    requireText(input.fingerprint, "fingerprint");
    const reviewerId = requireText(input.reviewerId, "reviewerId");
    const decision = careerRelationshipReviewDecisionSchema.parse(input.decision);
    const candidate = this.listRelationshipCandidates(input).find(
      (entry) => entry.id === input.id,
    );
    if (!candidate || candidate.fingerprint !== input.fingerprint) {
      throw new CareerEvidenceConflictError(
        "The relationship candidate changed or is no longer active. Refresh before deciding.",
      );
    }

    const reviewedAt = this.now().toISOString();
    const linkedRelationshipId = reviewedCareerRelationshipId(candidate.id);
    const decide = this.database.transaction(() => {
      this.database.prepare(
        `INSERT INTO career_relationship_reviews
          (id, actor_id, workspace_id, candidate_id, candidate_fingerprint,
           claim_id, source_relationship_id, decision, reviewed_by, reviewed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        randomUUID(),
        input.actorId,
        input.workspaceId,
        candidate.id,
        candidate.fingerprint,
        candidate.claimId,
        candidate.sourceRelationshipId,
        decision,
        reviewerId,
        reviewedAt,
      );
      if (decision === "approved") {
        this.upsertRelationship({
          id: linkedRelationshipId,
          actorId: input.actorId,
          workspaceId: input.workspaceId,
          sourceId: candidate.sourceId,
          claimId: candidate.claimId,
          fromKind: candidate.fromKind,
          fromId: candidate.fromId,
          relationship: candidate.relationship,
          toKind: candidate.toKind,
          toId: candidate.toId,
        });
      } else {
        this.database.prepare(
          `UPDATE career_relationships SET state = 'revoked', updated_at = ?
           WHERE id = ? AND actor_id = ? AND workspace_id = ?`,
        ).run(
          reviewedAt,
          linkedRelationshipId,
          input.actorId,
          input.workspaceId,
        );
      }
    });
    decide();

    const updated = this.listRelationshipCandidates(input).find(
      (entry) => entry.id === input.id,
    );
    if (!updated) {
      throw new CareerEvidenceConflictError(
        "The relationship candidate became unavailable after review.",
      );
    }
    return updated;
  }

  declareClaimConflict(
    input: DeclareCareerClaimConflictInput,
  ): CareerClaimConflict {
    const claimIds = normalizeConflictClaimIds(input.claimIds);
    const claims = claimIds.map((id) =>
      this.requireClaim(id, input.actorId, input.workspaceId)
    );
    if (claims.some((claim) => claim.state !== "active")) {
      throw new CareerEvidenceConflictError(
        "Only active career claims can enter an unresolved conflict.",
      );
    }
    const reviewerId = requireText(input.reviewerId, "reviewerId");
    const id = careerClaimConflictId({ ...input, claimIds });
    const existing = this.findClaimConflict(id, input.actorId, input.workspaceId);
    if (existing?.state === "unresolved") return existing;
    const now = this.now().toISOString();

    const declare = this.database.transaction(() => {
      const overlapping = this.listClaimConflicts(input).find((conflict) =>
        conflict.state === "unresolved" && conflict.id !== id &&
        conflict.claimIds.some((claimId) => claimIds.includes(claimId))
      );
      if (overlapping) {
        throw new CareerEvidenceConflictError(
          "A career claim can belong to only one unresolved conflict.",
        );
      }
      this.database.prepare(
        `INSERT INTO career_claim_conflicts
          (id, actor_id, workspace_id, claim_ids_json, state, reviewed_by,
           resolved_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'unresolved', ?, NULL, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           state = 'unresolved', reviewed_by = excluded.reviewed_by,
           resolved_by = NULL, updated_at = excluded.updated_at
         WHERE actor_id = excluded.actor_id AND workspace_id = excluded.workspace_id`,
      ).run(
        id,
        input.actorId,
        input.workspaceId,
        JSON.stringify(claimIds),
        reviewerId,
        now,
        now,
      );
    });
    declare();
    return this.requireClaimConflict(id, input.actorId, input.workspaceId);
  }

  resolveClaimConflict(
    input: ResolveCareerClaimConflictInput,
  ): CareerClaimConflict {
    const conflict = this.requireClaimConflict(
      input.id,
      input.actorId,
      input.workspaceId,
    );
    if (conflict.state === "resolved") return conflict;
    const now = this.now().toISOString();
    this.database.prepare(
      `UPDATE career_claim_conflicts
       SET state = 'resolved', resolved_by = ?, updated_at = ?
       WHERE id = ? AND actor_id = ? AND workspace_id = ?`,
    ).run(
      requireText(input.reviewerId, "reviewerId"),
      now,
      input.id,
      input.actorId,
      input.workspaceId,
    );
    return this.requireClaimConflict(input.id, input.actorId, input.workspaceId);
  }

  listSources(scope: CareerEvidenceScope): readonly CareerSource[] {
    return (this.database.prepare(
      `SELECT * FROM career_sources
       WHERE actor_id = ? AND workspace_id = ? ORDER BY created_at ASC, id ASC`,
    ).all(scope.actorId, scope.workspaceId) as SourceRow[]).map(mapSource);
  }

  listClaims(scope: CareerEvidenceScope): readonly CareerClaim[] {
    return (this.database.prepare(
      `SELECT * FROM career_claims
       WHERE actor_id = ? AND workspace_id = ? ORDER BY created_at ASC, id ASC`,
    ).all(scope.actorId, scope.workspaceId) as ClaimRow[]).map(mapClaim);
  }

  listClaimConflicts(scope: CareerEvidenceScope): readonly CareerClaimConflict[] {
    return (this.database.prepare(
      `SELECT * FROM career_claim_conflicts
       WHERE actor_id = ? AND workspace_id = ? ORDER BY created_at ASC, id ASC`,
    ).all(scope.actorId, scope.workspaceId) as ClaimConflictRow[])
      .map(mapClaimConflict);
  }

  listRelationships(scope: CareerEvidenceScope): readonly CareerRelationship[] {
    return (this.database.prepare(
      `SELECT * FROM career_relationships
       WHERE actor_id = ? AND workspace_id = ? ORDER BY created_at ASC, id ASC`,
    ).all(scope.actorId, scope.workspaceId) as RelationshipRow[]).map(mapRelationship);
  }

  listRelationshipReviews(
    scope: CareerEvidenceScope,
  ): readonly CareerRelationshipReview[] {
    return (this.database.prepare(
      `SELECT * FROM career_relationship_reviews
       WHERE actor_id = ? AND workspace_id = ?
       ORDER BY reviewed_at ASC, rowid ASC`,
    ).all(scope.actorId, scope.workspaceId) as RelationshipReviewRow[])
      .map(mapRelationshipReview);
  }

  listRelationshipCandidates(
    scope: CareerEvidenceScope,
  ): readonly CareerRelationshipCandidate[] {
    const evidenceScope: CareerEvidenceScope = {
      actorId: scope.actorId,
      workspaceId: scope.workspaceId,
    };
    const sources = new Map(
      this.listSources(scope)
        .filter((source) => source.state === "active")
        .map((source) => [source.id, source]),
    );
    const claims = this.listClaims(scope).filter(
      (claim) => claim.state === "active" && sources.has(claim.sourceId),
    );
    const relationships = this.listRelationships(scope);
    const sourceRelationships = relationships.filter(
      (relationship) =>
        relationship.state === "active" &&
        relationship.claimId === null &&
        sources.has(relationship.sourceId),
    );
    const latestReviews = new Map<string, CareerRelationshipReview>();
    for (const review of this.listRelationshipReviews(scope)) {
      latestReviews.set(review.candidateId, review);
    }

    const activeLinkedClaimIds = new Set(
      relationships
        .filter((relationship) =>
          relationship.state === "active" && relationship.claimId !== null
        )
        .map((relationship) => relationship.claimId!),
    );
    const candidatesByClaim = new Map<
      string,
      Array<Omit<CareerRelationshipCandidate, "claimQueueState">>
    >();
    for (const claim of claims) {
      const source = sources.get(claim.sourceId)!;
      for (const relationship of sourceRelationships) {
        if (relationship.sourceId !== claim.sourceId) continue;
        const id = careerRelationshipCandidateId({
          ...evidenceScope,
          claimId: claim.id,
          sourceRelationshipId: relationship.id,
        });
        const linkedRelationshipId = reviewedCareerRelationshipId(id);
        const exactActiveRelationship = relationships.find((entry) =>
          entry.state === "active" &&
          entry.claimId === claim.id &&
          entry.fromKind === relationship.fromKind &&
          entry.fromId === relationship.fromId &&
          entry.relationship === relationship.relationship &&
          entry.toKind === relationship.toKind &&
          entry.toId === relationship.toId
        );
        if (
          exactActiveRelationship &&
          exactActiveRelationship.id !== linkedRelationshipId
        ) {
          continue;
        }
        const fingerprint = careerRelationshipCandidateFingerprint({
          candidateId: id,
          sourceHash: source.sourceHash,
          claim,
          relationship,
        });
        const lastReview = latestReviews.get(id) ?? null;
        const linked = exactActiveRelationship?.id === linkedRelationshipId;
        const reviewIsCurrent = lastReview?.candidateFingerprint === fingerprint &&
          (lastReview.decision === "rejected" || linked);
        const candidate: Omit<CareerRelationshipCandidate, "claimQueueState"> = {
          id,
          fingerprint,
          ...evidenceScope,
          sourceId: source.id,
          claimId: claim.id,
          sourceRelationshipId: relationship.id,
          fromKind: relationship.fromKind,
          fromId: relationship.fromId,
          relationship: relationship.relationship,
          toKind: relationship.toKind,
          toId: relationship.toId,
          reviewState: reviewIsCurrent ? lastReview!.decision : "needs_review",
          lastReview,
          reviewIsCurrent,
          linkedRelationshipId: linked ? linkedRelationshipId : null,
        };
        const claimCandidates = candidatesByClaim.get(claim.id) ?? [];
        claimCandidates.push(candidate);
        candidatesByClaim.set(claim.id, claimCandidates);
      }
    }

    const boundedCandidates: CareerRelationshipCandidate[] = [];
    for (const claimCandidates of candidatesByClaim.values()) {
      claimCandidates.sort(compareRelationshipCandidates);
      if (activeLinkedClaimIds.has(claimCandidates[0]!.claimId)) {
        boundedCandidates.push(...claimCandidates
          .filter((candidate) =>
            candidate.reviewState === "approved" &&
            candidate.linkedRelationshipId !== null
          )
          .map((candidate) => ({ ...candidate, claimQueueState: "approved" as const })));
        continue;
      }

      const rejected = claimCandidates.filter(
        (candidate) => candidate.reviewState === "rejected",
      );
      const pending = claimCandidates.find(
        (candidate) => candidate.reviewState === "needs_review",
      );
      const claimQueueState = pending ? "pending" as const : "exhausted" as const;
      if (pending) boundedCandidates.push({ ...pending, claimQueueState });
      boundedCandidates.push(...rejected.map((candidate) => ({
        ...candidate,
        claimQueueState,
      })));
    }

    return boundedCandidates.sort((left, right) =>
      Number(left.reviewState !== "needs_review") -
        Number(right.reviewState !== "needs_review") ||
      left.sourceId.localeCompare(right.sourceId) ||
      left.claimId.localeCompare(right.claimId) ||
      compareRelationshipCandidates(left, right)
    );
  }

  listPublicClaims(scope: CareerEvidenceScope): readonly CareerClaim[] {
    const cutoff = reviewCutoff(this.now());
    return (this.database.prepare(
      `SELECT claim.* FROM career_claims claim
       INNER JOIN career_sources source ON source.id = claim.source_id
       WHERE claim.actor_id = ? AND claim.workspace_id = ?
         AND claim.state = 'active'
         AND claim.visibility = 'public_approved'
         AND claim.review_state = 'approved'
         AND claim.last_reviewed_at >= ?
         AND source.actor_id = claim.actor_id
         AND source.workspace_id = claim.workspace_id
         AND source.state = 'active'
         AND source.review_state = 'approved'
         AND source.last_reviewed_at >= ?
         AND source.provenance_uri IS NOT NULL
       ORDER BY claim.created_at ASC, claim.id ASC`,
    ).all(scope.actorId, scope.workspaceId, cutoff, cutoff) as ClaimRow[]).map(mapClaim);
  }

  validate(scope: CareerEvidenceScope): readonly CareerEvidenceValidationIssue[] {
    const sources = this.listSources(scope).filter((source) => source.state === "active");
    const claims = this.listClaims(scope).filter((claim) => claim.state === "active");
    const publicSourceIds = new Set(
      claims
        .filter((claim) =>
          claim.reviewState !== "rejected" &&
          (claim.visibility === "public_candidate" || claim.visibility === "public_approved")
        )
        .map((claim) => claim.sourceId),
    );
    const issues: CareerEvidenceValidationIssue[] = [];
    const cutoff = new Date(reviewCutoff(this.now()));

    for (const source of sources) {
      if (!source.provenanceRef && !source.provenanceUri) {
        issues.push(sourceIssue(source.id, "source_missing_provenance", "Source has no provenance reference."));
      }
      if (publicSourceIds.has(source.id) && !isPublicUri(source.provenanceUri)) {
        issues.push(sourceIssue(source.id, "source_public_provenance_missing", "Public candidate source has no public citation URI."));
      }
      if (
        source.reviewState === "needs_review" ||
        (source.reviewState === "approved" && !source.lastReviewedAt)
      ) {
        issues.push(sourceIssue(source.id, "source_review_required", "Source requires approval before use."));
      } else if (
        source.reviewState === "approved" &&
        source.lastReviewedAt &&
        new Date(source.lastReviewedAt) < cutoff
      ) {
        issues.push(sourceIssue(source.id, "source_review_stale", "Source review is older than 180 days."));
      }
    }

    for (const claim of claims) {
      if (
        claim.reviewState === "needs_review" ||
        (claim.reviewState === "approved" && !claim.lastReviewedAt)
      ) {
        issues.push(claimIssue(claim.id, "claim_review_required", "Claim requires approval before use."));
      } else if (
        claim.reviewState === "approved" &&
        claim.lastReviewedAt &&
        new Date(claim.lastReviewedAt) < cutoff
      ) {
        issues.push(claimIssue(claim.id, "claim_review_stale", "Claim review is older than 180 days."));
      }
    }
    return issues;
  }

  close(): void {
    this.database.close();
  }

  private validateClaimForApproval(
    claim: CareerClaim,
    requirePublicProvenance: boolean,
  ): readonly CareerEvidenceValidationIssue[] {
    const source = this.requireSource(claim.sourceId, claim.actorId, claim.workspaceId);
    const cutoff = new Date(reviewCutoff(this.now()));
    const issues: CareerEvidenceValidationIssue[] = [];
    if (requirePublicProvenance && !isPublicUri(source.provenanceUri)) {
      issues.push(sourceIssue(source.id, "source_public_provenance_missing", "Public approval requires a public citation URI."));
    }
    if (source.reviewState !== "approved" || !source.lastReviewedAt) {
      issues.push(sourceIssue(source.id, "source_review_required", "Public approval requires an approved source."));
    } else if (new Date(source.lastReviewedAt) < cutoff) {
      issues.push(sourceIssue(source.id, "source_review_stale", "Public approval requires a current source review."));
    }
    return issues;
  }

  private findSource(id: string, actorId: string, workspaceId: string): CareerSource | null {
    const row = this.database.prepare(
      `SELECT * FROM career_sources WHERE id = ? AND actor_id = ? AND workspace_id = ?`,
    ).get(id, actorId, workspaceId) as SourceRow | undefined;
    return row ? mapSource(row) : null;
  }

  private requireSource(id: string, actorId: string, workspaceId: string): CareerSource {
    const source = this.findSource(id, actorId, workspaceId);
    if (!source) throw new CareerEvidenceNotFoundError("source");
    return source;
  }

  private findActiveClaim(
    sourceId: string,
    logicalKey: string,
    actorId: string,
    workspaceId: string,
  ): CareerClaim | null {
    const row = this.database.prepare(
      `SELECT * FROM career_claims
       WHERE source_id = ? AND logical_key = ? AND actor_id = ? AND workspace_id = ?
         AND state = 'active'`,
    ).get(sourceId, logicalKey, actorId, workspaceId) as ClaimRow | undefined;
    return row ? mapClaim(row) : null;
  }

  private requireClaim(id: string, actorId: string, workspaceId: string): CareerClaim {
    const row = this.database.prepare(
      `SELECT * FROM career_claims WHERE id = ? AND actor_id = ? AND workspace_id = ?`,
    ).get(id, actorId, workspaceId) as ClaimRow | undefined;
    if (!row) throw new CareerEvidenceNotFoundError("claim");
    return mapClaim(row);
  }

  private requireRelationship(
    id: string,
    actorId: string,
    workspaceId: string,
  ): CareerRelationship {
    const row = this.database.prepare(
      `SELECT * FROM career_relationships
       WHERE id = ? AND actor_id = ? AND workspace_id = ?`,
    ).get(id, actorId, workspaceId) as RelationshipRow | undefined;
    if (!row) throw new CareerEvidenceNotFoundError("claim");
    return mapRelationship(row);
  }

  private requireClaimConflict(
    id: string,
    actorId: string,
    workspaceId: string,
  ): CareerClaimConflict {
    const conflict = this.findClaimConflict(id, actorId, workspaceId);
    if (!conflict) throw new CareerEvidenceNotFoundError("conflict");
    return conflict;
  }

  private findClaimConflict(
    id: string,
    actorId: string,
    workspaceId: string,
  ): CareerClaimConflict | null {
    const row = this.database.prepare(
      `SELECT * FROM career_claim_conflicts
       WHERE id = ? AND actor_id = ? AND workspace_id = ?`,
    ).get(id, actorId, workspaceId) as ClaimConflictRow | undefined;
    return row ? mapClaimConflict(row) : null;
  }

  private revokeReviewedRelationshipsForSource(
    sourceId: string,
    scope: CareerEvidenceScope,
    updatedAt: string,
  ): void {
    const sourceRelationshipIds = this.listRelationships(scope)
      .filter((relationship) =>
        relationship.sourceId === sourceId && relationship.claimId === null
      )
      .map((relationship) => relationship.id);
    for (const relationshipId of sourceRelationshipIds) {
      this.revokeReviewedRelationshipsForSourceRelationship(
        relationshipId,
        scope,
        updatedAt,
      );
    }
  }

  private revokeReviewedRelationshipsForClaim(
    claimId: string,
    scope: CareerEvidenceScope,
    updatedAt: string,
  ): void {
    const reviewedIds = new Set(
      this.listRelationshipReviews(scope)
        .filter((review) =>
          review.claimId === claimId && review.decision === "approved"
        )
        .map((review) => reviewedCareerRelationshipId(review.candidateId)),
    );
    const revoke = this.database.prepare(
      `UPDATE career_relationships SET state = 'revoked', updated_at = ?
       WHERE id = ? AND actor_id = ? AND workspace_id = ? AND state = 'active'`,
    );
    for (const reviewedId of reviewedIds) {
      revoke.run(updatedAt, reviewedId, scope.actorId, scope.workspaceId);
    }
  }

  private revokeReviewedRelationshipsForSourceRelationship(
    sourceRelationshipId: string,
    scope: CareerEvidenceScope,
    updatedAt: string,
  ): void {
    const reviewedIds = new Set(
      this.listRelationshipReviews(scope)
        .filter((review) =>
          review.sourceRelationshipId === sourceRelationshipId &&
          review.decision === "approved"
        )
        .map((review) => reviewedCareerRelationshipId(review.candidateId)),
    );
    const revoke = this.database.prepare(
      `UPDATE career_relationships SET state = 'revoked', updated_at = ?
       WHERE id = ? AND actor_id = ? AND workspace_id = ? AND state = 'active'`,
    );
    for (const reviewedId of reviewedIds) {
      revoke.run(updatedAt, reviewedId, scope.actorId, scope.workspaceId);
    }
  }

  private migrate(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS career_sources (
        id TEXT PRIMARY KEY,
        actor_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        source_type TEXT NOT NULL CHECK(source_type IN (
          'resume', 'employer_history', 'recommendation', 'project', 'repository',
          'release_artifact', 'portfolio_page', 'confirmed_fact', 'career_note'
        )),
        title TEXT NOT NULL,
        provenance_ref TEXT,
        provenance_uri TEXT,
        source_hash TEXT NOT NULL,
        captured_at TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        review_state TEXT NOT NULL CHECK(review_state IN ('needs_review', 'approved', 'rejected')),
        reviewed_by TEXT,
        last_reviewed_at TEXT,
        state TEXT NOT NULL CHECK(state IN ('active', 'missing', 'revoked')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS career_sources_scope_review
        ON career_sources(actor_id, workspace_id, state, review_state, updated_at DESC);

      CREATE TABLE IF NOT EXISTS career_claims (
        id TEXT PRIMARY KEY,
        actor_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        source_id TEXT NOT NULL REFERENCES career_sources(id) ON DELETE RESTRICT,
        logical_key TEXT NOT NULL,
        title TEXT NOT NULL,
        proposition TEXT NOT NULL,
        contribution TEXT NOT NULL,
        maturity TEXT NOT NULL CHECK(maturity IN (
          'not_applicable', 'planning', 'prototype', 'development', 'pre_release',
          'deployed_demo', 'production', 'released_product'
        )),
        visibility TEXT NOT NULL CHECK(visibility IN (
          'private', 'internal_approved', 'public_candidate', 'public_approved'
        )),
        review_state TEXT NOT NULL CHECK(review_state IN ('needs_review', 'approved', 'rejected')),
        reviewed_by TEXT,
        last_reviewed_at TEXT,
        supersedes_claim_id TEXT REFERENCES career_claims(id) ON DELETE SET NULL,
        state TEXT NOT NULL CHECK(state IN ('active', 'superseded', 'revoked')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS career_claims_active_logical_key
        ON career_claims(actor_id, workspace_id, source_id, logical_key)
        WHERE state = 'active';
      CREATE INDEX IF NOT EXISTS career_claims_public_export
        ON career_claims(actor_id, workspace_id, state, visibility, review_state, last_reviewed_at);

      CREATE TABLE IF NOT EXISTS career_claim_conflicts (
        id TEXT PRIMARY KEY,
        actor_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        claim_ids_json TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('unresolved', 'resolved')),
        reviewed_by TEXT NOT NULL,
        resolved_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS career_claim_conflicts_scope
        ON career_claim_conflicts(actor_id, workspace_id, state, created_at ASC);

      CREATE TABLE IF NOT EXISTS career_relationships (
        id TEXT PRIMARY KEY,
        actor_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        source_id TEXT NOT NULL REFERENCES career_sources(id) ON DELETE RESTRICT,
        claim_id TEXT REFERENCES career_claims(id) ON DELETE SET NULL,
        from_kind TEXT NOT NULL CHECK(from_kind IN (
          'person', 'employer', 'role', 'project', 'skill', 'domain', 'artifact',
          'capability', 'claim'
        )),
        from_id TEXT NOT NULL,
        relationship TEXT NOT NULL CHECK(relationship IN (
          'employed_by', 'held_role', 'contributed_to', 'demonstrates', 'uses_skill',
          'in_domain', 'supports', 'related_to'
        )),
        to_kind TEXT NOT NULL CHECK(to_kind IN (
          'person', 'employer', 'role', 'project', 'skill', 'domain', 'artifact',
          'capability', 'claim'
        )),
        to_id TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('active', 'revoked')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS career_relationships_scope
        ON career_relationships(actor_id, workspace_id, state, from_kind, from_id);

      CREATE TABLE IF NOT EXISTS career_relationship_reviews (
        id TEXT PRIMARY KEY,
        actor_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        candidate_id TEXT NOT NULL,
        candidate_fingerprint TEXT NOT NULL,
        claim_id TEXT NOT NULL REFERENCES career_claims(id) ON DELETE RESTRICT,
        source_relationship_id TEXT NOT NULL REFERENCES career_relationships(id) ON DELETE RESTRICT,
        decision TEXT NOT NULL CHECK(decision IN ('approved', 'rejected')),
        reviewed_by TEXT NOT NULL,
        reviewed_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS career_relationship_reviews_scope_candidate
        ON career_relationship_reviews(
          actor_id, workspace_id, candidate_id, reviewed_at DESC, id DESC
        );
    `);
    this.upgradeCareerSourceSchema();
  }

  private upgradeCareerSourceSchema(): void {
    const columns = this.database.pragma("table_info(career_sources)") as Array<{
      readonly name: string;
    }>;
    if (!columns.some((column) => column.name === "metadata_json")) {
      this.database.exec(
        "ALTER TABLE career_sources ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}'",
      );
    }

    const table = this.database.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'career_sources'",
    ).get() as { readonly sql: string } | undefined;
    if (table?.sql.includes("'career_note'") && table.sql.includes("'missing'")) {
      return;
    }

    this.database.pragma("foreign_keys = OFF");
    this.database.pragma("legacy_alter_table = ON");
    const rebuild = this.database.transaction(() => {
      this.database.exec(`
        DROP INDEX IF EXISTS career_sources_scope_review;
        ALTER TABLE career_sources RENAME TO career_sources_legacy;
        CREATE TABLE career_sources (
          id TEXT PRIMARY KEY,
          actor_id TEXT NOT NULL,
          workspace_id TEXT NOT NULL,
          source_type TEXT NOT NULL CHECK(source_type IN (
            'resume', 'employer_history', 'recommendation', 'project', 'repository',
            'release_artifact', 'portfolio_page', 'confirmed_fact', 'career_note'
          )),
          title TEXT NOT NULL,
          provenance_ref TEXT,
          provenance_uri TEXT,
          source_hash TEXT NOT NULL,
          captured_at TEXT NOT NULL,
          metadata_json TEXT NOT NULL DEFAULT '{}',
          review_state TEXT NOT NULL CHECK(review_state IN ('needs_review', 'approved', 'rejected')),
          reviewed_by TEXT,
          last_reviewed_at TEXT,
          state TEXT NOT NULL CHECK(state IN ('active', 'missing', 'revoked')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT INTO career_sources
          (id, actor_id, workspace_id, source_type, title, provenance_ref,
           provenance_uri, source_hash, captured_at, metadata_json, review_state,
           reviewed_by, last_reviewed_at, state, created_at, updated_at)
        SELECT id, actor_id, workspace_id, source_type, title, provenance_ref,
          provenance_uri, source_hash, captured_at, metadata_json, review_state,
          reviewed_by, last_reviewed_at, state, created_at, updated_at
        FROM career_sources_legacy;
        DROP TABLE career_sources_legacy;
        CREATE INDEX career_sources_scope_review
          ON career_sources(actor_id, workspace_id, state, review_state, updated_at DESC);
      `);
    });
    try {
      rebuild();
    } finally {
      this.database.pragma("legacy_alter_table = OFF");
      this.database.pragma("foreign_keys = ON");
    }
    const violations = this.database.pragma("foreign_key_check") as unknown[];
    if (violations.length > 0) {
      throw new CareerEvidenceConflictError(
        "Career source schema migration left invalid evidence references.",
      );
    }
  }
}

function mapSource(row: SourceRow): CareerSource {
  return {
    id: row.id,
    actorId: row.actor_id,
    workspaceId: row.workspace_id,
    sourceType: row.source_type,
    title: row.title,
    provenanceRef: row.provenance_ref,
    provenanceUri: row.provenance_uri,
    sourceHash: row.source_hash,
    capturedAt: row.captured_at,
    metadata: parseSourceMetadata(row.metadata_json),
    reviewState: row.review_state,
    reviewedBy: row.reviewed_by,
    lastReviewedAt: row.last_reviewed_at,
    state: row.state,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapClaim(row: ClaimRow): CareerClaim {
  return {
    id: row.id,
    actorId: row.actor_id,
    workspaceId: row.workspace_id,
    sourceId: row.source_id,
    logicalKey: row.logical_key,
    title: row.title,
    proposition: row.proposition,
    contribution: row.contribution,
    maturity: row.maturity,
    visibility: row.visibility,
    reviewState: row.review_state,
    reviewedBy: row.reviewed_by,
    lastReviewedAt: row.last_reviewed_at,
    supersedesClaimId: row.supersedes_claim_id,
    state: row.state,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapClaimConflict(row: ClaimConflictRow): CareerClaimConflict {
  return {
    id: row.id,
    actorId: row.actor_id,
    workspaceId: row.workspace_id,
    claimIds: normalizeConflictClaimIds(JSON.parse(row.claim_ids_json)),
    state: row.state,
    reviewedBy: row.reviewed_by,
    resolvedBy: row.resolved_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRelationship(row: RelationshipRow): CareerRelationship {
  return {
    id: row.id,
    actorId: row.actor_id,
    workspaceId: row.workspace_id,
    sourceId: row.source_id,
    claimId: row.claim_id,
    fromKind: row.from_kind,
    fromId: row.from_id,
    relationship: row.relationship,
    toKind: row.to_kind,
    toId: row.to_id,
    state: row.state,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRelationshipReview(
  row: RelationshipReviewRow,
): CareerRelationshipReview {
  return {
    id: row.id,
    actorId: row.actor_id,
    workspaceId: row.workspace_id,
    candidateId: row.candidate_id,
    candidateFingerprint: row.candidate_fingerprint,
    claimId: row.claim_id,
    sourceRelationshipId: row.source_relationship_id,
    decision: row.decision,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
  };
}

function compareRelationshipCandidates(
  left: Pick<CareerRelationshipCandidate, "relationship" | "sourceRelationshipId" | "id">,
  right: Pick<CareerRelationshipCandidate, "relationship" | "sourceRelationshipId" | "id">,
): number {
  return RELATIONSHIP_REVIEW_PRIORITY[left.relationship] -
      RELATIONSHIP_REVIEW_PRIORITY[right.relationship] ||
    left.sourceRelationshipId.localeCompare(right.sourceRelationshipId) ||
    left.id.localeCompare(right.id);
}

function claimMatches(
  claim: CareerClaim,
  input: UpsertCareerClaimInput,
  visibility: CareerVisibility,
): boolean {
  return claim.title === input.title &&
    claim.proposition === input.proposition &&
    claim.contribution === input.contribution &&
    claim.maturity === input.maturity &&
    importVisibilityMatches(claim.visibility, visibility);
}

function importVisibilityMatches(
  current: CareerVisibility,
  proposed: CareerVisibility,
): boolean {
  return current === proposed ||
    (current === "public_approved" && proposed === "public_candidate") ||
    (current === "internal_approved" && proposed === "private");
}

function assertSourceInput(input: UpsertCareerSourceInput): void {
  requireText(input.id, "id");
  requireText(input.actorId, "actorId");
  requireText(input.workspaceId, "workspaceId");
  requireText(input.title, "title");
  careerSourceTypeSchema.parse(input.sourceType);
  if (!/^[a-f0-9]{64}$/.test(input.sourceHash)) {
    throw new RangeError("Career source hash must be a SHA-256 digest.");
  }
  normalizeTimestamp(input.capturedAt, "capturedAt");
}

function assertClaimInput(input: UpsertCareerClaimInput): void {
  requireText(input.actorId, "actorId");
  requireText(input.workspaceId, "workspaceId");
  requireText(input.sourceId, "sourceId");
  requireText(input.logicalKey, "logicalKey");
  requireText(input.title, "title");
  requireText(input.proposition, "proposition");
  requireText(input.contribution, "contribution");
  careerMaturitySchema.parse(input.maturity);
  if (input.visibility) {
    const visibility = careerVisibilitySchema.parse(input.visibility);
    if (visibility === "public_approved") {
      throw new CareerEvidenceConflictError("Imports cannot create public-approved claims.");
    }
  }
}

function assertRelationshipInput(input: UpsertCareerRelationshipInput): void {
  requireText(input.id, "id");
  requireText(input.actorId, "actorId");
  requireText(input.workspaceId, "workspaceId");
  requireText(input.sourceId, "sourceId");
  requireText(input.fromId, "fromId");
  requireText(input.toId, "toId");
  careerEntityKindSchema.parse(input.fromKind);
  careerEntityKindSchema.parse(input.toKind);
  careerRelationshipKindSchema.parse(input.relationship);
}

function normalizeTimestamp(value: string, field: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new RangeError(`${field} must be an ISO timestamp.`);
  return parsed.toISOString();
}

function normalizeSourceMetadata(
  metadata: Partial<CareerSourceMetadata> | undefined,
): CareerSourceMetadata {
  return {
    relativePath: metadata?.relativePath?.trim() || null,
    tags: normalizeStringList(metadata?.tags),
    aliases: normalizeStringList(metadata?.aliases),
    wikiLinks: normalizeStringList(metadata?.wikiLinks),
    markdownLinks: normalizeStringList(metadata?.markdownLinks),
    headings: (metadata?.headings ?? [])
      .filter((heading) =>
        Number.isInteger(heading.level) &&
        heading.level >= 1 &&
        heading.level <= 6 &&
        heading.text.trim().length > 0
      )
      .map((heading) => ({ level: heading.level, text: heading.text.trim() })),
    frontmatterKeys: normalizeStringList(metadata?.frontmatterKeys),
    documentDate: metadata?.documentDate?.trim() || null,
  };
}

function parseSourceMetadata(serialized: string): CareerSourceMetadata {
  try {
    const value = JSON.parse(serialized) as Partial<CareerSourceMetadata>;
    return normalizeSourceMetadata(value);
  } catch {
    throw new CareerEvidenceConflictError(
      "Career source metadata is not valid JSON.",
    );
  }
}

function normalizeStringList(values: readonly string[] | undefined): readonly string[] {
  return Array.from(
    new Set((values ?? []).map((value) => value.trim()).filter(Boolean)),
  ).sort((left, right) => left.localeCompare(right));
}

function normalizeConflictClaimIds(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 5) {
    throw new CareerEvidenceConflictError(
      "A career claim conflict requires two through five claim IDs.",
    );
  }
  const claimIds = value.map((item) => {
    if (typeof item !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(item)) {
      throw new CareerEvidenceConflictError(
        "Career claim conflict members must be UUID claim IDs.",
      );
    }
    return item.toLowerCase();
  });
  if (new Set(claimIds).size !== claimIds.length) {
    throw new CareerEvidenceConflictError(
      "Career claim conflict members must be unique.",
    );
  }
  return claimIds.sort((left, right) => left.localeCompare(right));
}

function requireText(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new RangeError(`${field} cannot be empty.`);
  return trimmed;
}

function reviewCutoff(now: Date): string {
  return new Date(now.getTime() - REVIEW_MAX_AGE_DAYS * 24 * 60 * 60 * 1_000).toISOString();
}

function isPublicUri(value: string | null): boolean {
  if (!value) return false;
  if (value.startsWith("/")) return true;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function sourceIssue(
  recordId: string,
  code: Extract<CareerEvidenceValidationIssue["code"], `source_${string}`>,
  message: string,
): CareerEvidenceValidationIssue {
  return { code, recordKind: "source", recordId, message };
}

function claimIssue(
  recordId: string,
  code: Extract<CareerEvidenceValidationIssue["code"], `claim_${string}`>,
  message: string,
): CareerEvidenceValidationIssue {
  return { code, recordKind: "claim", recordId, message };
}
