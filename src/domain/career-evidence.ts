import { z } from "zod";

export const careerSourceTypeSchema = z.enum([
  "resume",
  "employer_history",
  "recommendation",
  "project",
  "repository",
  "release_artifact",
  "portfolio_page",
  "confirmed_fact",
  "career_note",
]);
export type CareerSourceType = z.infer<typeof careerSourceTypeSchema>;

export const careerVisibilitySchema = z.enum([
  "private",
  "internal_approved",
  "public_candidate",
  "public_approved",
]);
export type CareerVisibility = z.infer<typeof careerVisibilitySchema>;

export const careerMaturitySchema = z.enum([
  "not_applicable",
  "planning",
  "prototype",
  "development",
  "pre_release",
  "deployed_demo",
  "production",
  "released_product",
]);
export type CareerMaturity = z.infer<typeof careerMaturitySchema>;

export const evidenceReviewStateSchema = z.enum([
  "needs_review",
  "approved",
  "rejected",
]);
export type EvidenceReviewState = z.infer<typeof evidenceReviewStateSchema>;

export const careerRecordStateSchema = z.enum([
  "active",
  "superseded",
  "revoked",
]);
export type CareerRecordState = z.infer<typeof careerRecordStateSchema>;

export const careerSourceStateSchema = z.enum(["active", "missing", "revoked"]);
export type CareerSourceState = z.infer<typeof careerSourceStateSchema>;

export interface CareerSourceHeading {
  readonly level: number;
  readonly text: string;
}

export interface CareerSourceMetadata {
  readonly relativePath: string | null;
  readonly tags: readonly string[];
  readonly aliases: readonly string[];
  readonly wikiLinks: readonly string[];
  readonly markdownLinks: readonly string[];
  readonly headings: readonly CareerSourceHeading[];
  readonly frontmatterKeys: readonly string[];
  readonly documentDate: string | null;
}

export const careerEntityKindSchema = z.enum([
  "person",
  "employer",
  "role",
  "project",
  "skill",
  "domain",
  "artifact",
  "capability",
  "claim",
]);
export type CareerEntityKind = z.infer<typeof careerEntityKindSchema>;

export const careerRelationshipKindSchema = z.enum([
  "employed_by",
  "held_role",
  "contributed_to",
  "demonstrates",
  "uses_skill",
  "in_domain",
  "supports",
  "related_to",
]);
export type CareerRelationshipKind = z.infer<
  typeof careerRelationshipKindSchema
>;

export interface CareerSource {
  readonly id: string;
  readonly actorId: string;
  readonly workspaceId: string;
  readonly sourceType: CareerSourceType;
  readonly title: string;
  readonly provenanceRef: string | null;
  readonly provenanceUri: string | null;
  readonly sourceHash: string;
  readonly capturedAt: string;
  readonly metadata: CareerSourceMetadata;
  readonly reviewState: EvidenceReviewState;
  readonly reviewedBy: string | null;
  readonly lastReviewedAt: string | null;
  readonly state: CareerSourceState;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CareerClaim {
  readonly id: string;
  readonly actorId: string;
  readonly workspaceId: string;
  readonly sourceId: string;
  readonly logicalKey: string;
  readonly title: string;
  readonly proposition: string;
  readonly contribution: string;
  readonly maturity: CareerMaturity;
  readonly visibility: CareerVisibility;
  readonly reviewState: EvidenceReviewState;
  readonly reviewedBy: string | null;
  readonly lastReviewedAt: string | null;
  readonly supersedesClaimId: string | null;
  readonly state: CareerRecordState;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CareerRelationship {
  readonly id: string;
  readonly actorId: string;
  readonly workspaceId: string;
  readonly sourceId: string;
  readonly claimId: string | null;
  readonly fromKind: CareerEntityKind;
  readonly fromId: string;
  readonly relationship: CareerRelationshipKind;
  readonly toKind: CareerEntityKind;
  readonly toId: string;
  readonly state: "active" | "revoked";
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type CareerEvidenceValidationCode =
  | "source_missing_provenance"
  | "source_public_provenance_missing"
  | "source_review_required"
  | "source_review_stale"
  | "claim_review_required"
  | "claim_review_stale";

export interface CareerEvidenceValidationIssue {
  readonly code: CareerEvidenceValidationCode;
  readonly recordKind: "source" | "claim";
  readonly recordId: string;
  readonly message: string;
}

export interface UpsertCareerSourceInput {
  readonly id: string;
  readonly actorId: string;
  readonly workspaceId: string;
  readonly sourceType: CareerSourceType;
  readonly title: string;
  readonly provenanceRef: string | null;
  readonly provenanceUri: string | null;
  readonly sourceHash: string;
  readonly capturedAt: string;
  readonly metadata?: Partial<CareerSourceMetadata>;
}

export interface UpsertCareerClaimInput {
  readonly actorId: string;
  readonly workspaceId: string;
  readonly sourceId: string;
  readonly logicalKey: string;
  readonly title: string;
  readonly proposition: string;
  readonly contribution: string;
  readonly maturity: CareerMaturity;
  readonly visibility?: Exclude<CareerVisibility, "public_approved">;
}

export interface DecideCareerSourceInput {
  readonly id: string;
  readonly actorId: string;
  readonly workspaceId: string;
  readonly decision: "approved" | "rejected";
  readonly reviewerId: string;
}

export interface DecideCareerClaimInput {
  readonly id: string;
  readonly actorId: string;
  readonly workspaceId: string;
  readonly decision: "approve_internal" | "approve_public" | "reject";
  readonly reviewerId: string;
}

export interface UpsertCareerRelationshipInput {
  readonly id: string;
  readonly actorId: string;
  readonly workspaceId: string;
  readonly sourceId: string;
  readonly claimId: string | null;
  readonly fromKind: CareerEntityKind;
  readonly fromId: string;
  readonly relationship: CareerRelationshipKind;
  readonly toKind: CareerEntityKind;
  readonly toId: string;
}

export interface CareerEvidenceScope {
  readonly actorId: string;
  readonly workspaceId: string;
}

export interface CareerEvidenceStore {
  upsertSource(input: UpsertCareerSourceInput): CareerSource;
  upsertDraftClaim(input: UpsertCareerClaimInput): CareerClaim;
  decideSource(input: DecideCareerSourceInput): CareerSource;
  decideClaim(input: DecideCareerClaimInput): CareerClaim;
  markSourceMissing(id: string, scope: CareerEvidenceScope): CareerSource;
  supersedeClaimsNotInSource(
    sourceId: string,
    activeLogicalKeys: readonly string[],
    scope: CareerEvidenceScope,
  ): number;
  revokeRelationshipsNotInSource(
    sourceId: string,
    activeRelationshipIds: readonly string[],
    scope: CareerEvidenceScope,
  ): number;
  revokeSource(id: string, scope: CareerEvidenceScope): CareerSource;
  revokeClaim(id: string, scope: CareerEvidenceScope): CareerClaim;
  upsertRelationship(input: UpsertCareerRelationshipInput): CareerRelationship;
  listSources(scope: CareerEvidenceScope): readonly CareerSource[];
  listClaims(scope: CareerEvidenceScope): readonly CareerClaim[];
  listRelationships(scope: CareerEvidenceScope): readonly CareerRelationship[];
  listPublicClaims(scope: CareerEvidenceScope): readonly CareerClaim[];
  validate(scope: CareerEvidenceScope): readonly CareerEvidenceValidationIssue[];
  close(): void;
}

export class CareerEvidenceNotFoundError extends Error {
  constructor(recordKind: "source" | "claim") {
    super(`The requested career ${recordKind} does not exist in this scope.`);
    this.name = "CareerEvidenceNotFoundError";
  }
}

export class CareerEvidenceConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CareerEvidenceConflictError";
  }
}

export class CareerEvidenceApprovalError extends Error {
  readonly issues: readonly CareerEvidenceValidationIssue[];

  constructor(issues: readonly CareerEvidenceValidationIssue[]) {
    super("Career evidence cannot be approved for public use until its review issues are resolved.");
    this.name = "CareerEvidenceApprovalError";
    this.issues = issues;
  }
}
