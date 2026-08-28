import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { preallocationCapacityLedgerSchema } from
  "./personality-preallocation-capacity-ledger.js";
import { loadPersonalityPreallocationCapacityManifestV1 } from
  "./personality-preallocation-capacity-manifest.js";
import { loadS03DuplicateOverlapAudit } from
  "./personality-s03-duplicate-overlap-audit.js";

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const reviewerSchema = z.object({
  reviewer_id: z.string().min(1),
  tool: z.string().min(1),
  model: z.string().min(1),
  reviewed_at: z.string().datetime(),
}).strict();
const commonReviewSchema = z.object({
  schema_version: z.literal("personality-s03-duplicate-overlap-review-v1"),
  review_role: z.enum(["primary", "independent"]),
  reviewer: reviewerSchema,
  audit_fingerprint: sha256Schema,
  prerequisite_fingerprints: z.record(z.string(), z.union([sha256Schema, z.null()])),
  counts: z.record(z.string(), z.number().int().nonnegative()),
  policy_verdict: z.literal("pass"),
  group_discrepancies: z.array(z.unknown()).length(0),
  rights_audit: z.object({
    verdict: z.literal("pass"),
    source_content_persisted: z.literal(false),
    selection_performed: z.literal(false),
    observation_coding_performed: z.literal(false),
    runtime_activation: z.literal("prohibited"),
  }).passthrough(),
}).strict();

const frozenReviewSchema = z.object({
  reviewRole: z.enum(["primary", "independent"]),
  reportFingerprint: sha256Schema,
  reviewerId: z.string().min(1),
  tool: z.string().min(1),
  model: z.string().min(1),
  reviewedAt: z.string().datetime(),
  verdict: z.literal("pass"),
  discrepancyCount: z.literal(0),
}).strict();
const countSchema = z.object({
  eligibleOccurrences: z.literal(270),
  uniqueFingerprintGroups: z.literal(133),
  duplicateFingerprintGroups: z.literal(133),
  duplicateOccurrencesBeyondRepresentative: z.literal(137),
  cleanConsensusGroups: z.literal(70),
  uncertaintyWithheldGroups: z.literal(63),
  metadataConflictGroups: z.literal(41),
  groupsContainingPriorUncertainty: z.literal(28),
  proposedAdmittedHighRiskGroups: z.literal(49),
}).strict();
const prerequisiteSchema = z.object({
  sourceRegisterFingerprint: sha256Schema,
  boundaryProtocolFingerprint: sha256Schema,
  highRiskTaxonomyFingerprint: sha256Schema,
  capacityManifestFingerprint: sha256Schema,
  capacityLedgerArtifactFingerprint: sha256Schema,
  capacityLedgerFingerprint: sha256Schema,
  samplingPlanV4OutcomeFingerprint: sha256Schema,
  sourceContentFingerprint: sha256Schema,
  boundaryManifestFingerprint: sha256Schema,
  ledgerFingerprintMapFingerprint: sha256Schema,
}).strict();

export const s03DuplicateOverlapAmendmentSchema = z.object({
  schemaVersion: z.literal("jolene.personality-s03-duplicate-overlap-amendment.v1"),
  status: z.literal("independently-reviewed-before-new-plan"),
  frozenAt: z.string().datetime(),
  sourceRegisterId: z.literal("S03"),
  sourceEventId: z.literal("E003"),
  auditFingerprint: sha256Schema,
  prerequisites: prerequisiteSchema,
  policy: z.object({
    equivalence: z.literal("exact-canonical-segment-fingerprint"),
    representative: z.literal("lowest-source-unit-ordinal-then-capacity-unit-id"),
    consensusAdmission: z.literal(
      "all-members-consensus-and-identical-agreed-strata-else-withhold-entire-group",
    ),
    conflictResult: z.literal("withhold-entire-group-never-union"),
    blindToFameQuotabilityAndTraitOutcome: z.literal(true),
  }).strict(),
  counts: countSchema,
  reviews: z.tuple([frozenReviewSchema, frozenReviewSchema]),
  rights: z.object({
    repositoryStorage: z.literal("metadata-hashes-identifiers-locators-and-controlled-labels-only"),
    sourceContent: z.literal("prohibited"),
    excerpts: z.literal("prohibited"),
    transcripts: z.literal("prohibited"),
    recognizableExpression: z.literal("prohibited"),
  }).strict(),
  sourceContentStored: z.literal(false),
  selectionPerformed: z.literal(false),
  observationCodingPerformed: z.literal(false),
  traitAdmission: z.literal("prohibited"),
  runtimeActivation: z.literal("prohibited"),
  nextAction: z.literal("derive-unique-capacity-view-and-freeze-new-sampling-plan-version"),
}).strict().superRefine((amendment, context) => {
  if (amendment.reviews[0].reviewRole !== "primary" ||
      amendment.reviews[1].reviewRole !== "independent" ||
      amendment.reviews[0].reviewerId === amendment.reviews[1].reviewerId ||
      amendment.reviews[0].reportFingerprint === amendment.reviews[1].reportFingerprint) {
    context.addIssue({ code: "custom", message: "Two distinct ordered reviews are required" });
  }
  if (amendment.reviews.some(
    (review) => Date.parse(review.reviewedAt) > Date.parse(amendment.frozenAt),
  )) {
    context.addIssue({ code: "custom", message: "Amendment predates a frozen review" });
  }
});

export type S03DuplicateOverlapAmendment =
  z.infer<typeof s03DuplicateOverlapAmendmentSchema>;

export async function buildS03DuplicateOverlapAmendment(
  primaryText: string,
  independentText: string,
  frozenAt: string,
  projectRoot = process.cwd(),
): Promise<S03DuplicateOverlapAmendment> {
  const primary = commonReviewSchema.parse(JSON.parse(primaryText));
  const independent = commonReviewSchema.parse(JSON.parse(independentText));
  if (primary.review_role !== "primary" || independent.review_role !== "independent") {
    throw new Error("S03 duplicate-overlap review roles are invalid");
  }
  const [audit, capacity] = await Promise.all([
    loadS03DuplicateOverlapAudit(projectRoot),
    loadPersonalityPreallocationCapacityManifestV1(projectRoot),
  ]);
  const capacityEntry = capacity.ledgers.find((entry) => entry.sourceRegisterId === "S03");
  if (!capacityEntry) throw new Error("S03 capacity entry is missing");
  const ledgerText = await readFile(path.resolve(projectRoot, capacityEntry.ledgerArtifact), "utf8");
  const ledger = preallocationCapacityLedgerSchema.parse(JSON.parse(ledgerText));
  const prerequisites = {
    sourceRegisterFingerprint: audit.sourceRegisterFingerprint,
    boundaryProtocolFingerprint: ledger.boundaryProtocolFingerprint,
    highRiskTaxonomyFingerprint: ledger.highRiskTaxonomyFingerprint,
    capacityManifestFingerprint: audit.capacityManifestFingerprint,
    capacityLedgerArtifactFingerprint: audit.capacityLedgerArtifactFingerprint,
    capacityLedgerFingerprint: audit.capacityLedgerFingerprint,
    samplingPlanV4OutcomeFingerprint: audit.samplingPlanV4OutcomeFingerprint,
    sourceContentFingerprint: ledger.sourceContentFingerprint,
    boundaryManifestFingerprint: ledger.boundaryManifestFingerprint,
    ledgerFingerprintMapFingerprint: ledger.ledgerFingerprintMapFingerprint,
  };
  validateReview(primary, audit.auditFingerprint, prerequisites, audit.counts);
  validateReview(independent, audit.auditFingerprint, prerequisites, audit.counts);
  return s03DuplicateOverlapAmendmentSchema.parse({
    schemaVersion: "jolene.personality-s03-duplicate-overlap-amendment.v1",
    status: "independently-reviewed-before-new-plan",
    frozenAt,
    sourceRegisterId: "S03",
    sourceEventId: "E003",
    auditFingerprint: audit.auditFingerprint,
    prerequisites,
    policy: {
      ...audit.policy,
      conflictResult: "withhold-entire-group-never-union",
    },
    counts: audit.counts,
    reviews: [freezeReview(primary, primaryText), freezeReview(independent, independentText)],
    rights: {
      repositoryStorage: "metadata-hashes-identifiers-locators-and-controlled-labels-only",
      sourceContent: "prohibited",
      excerpts: "prohibited",
      transcripts: "prohibited",
      recognizableExpression: "prohibited",
    },
    sourceContentStored: false,
    selectionPerformed: false,
    observationCodingPerformed: false,
    traitAdmission: "prohibited",
    runtimeActivation: "prohibited",
    nextAction: "derive-unique-capacity-view-and-freeze-new-sampling-plan-version",
  });
}

export async function loadS03DuplicateOverlapAmendment(projectRoot = process.cwd()) {
  const amendmentText = await readFile(path.resolve(
    projectRoot, "research/s03-duplicate-overlap-amendment-v1.json",
  ), "utf8");
  const amendment = s03DuplicateOverlapAmendmentSchema.parse(JSON.parse(amendmentText));
  const [audit, capacity] = await Promise.all([
    loadS03DuplicateOverlapAudit(projectRoot),
    loadPersonalityPreallocationCapacityManifestV1(projectRoot),
  ]);
  const capacityEntry = capacity.ledgers.find((entry) => entry.sourceRegisterId === "S03");
  if (!capacityEntry) throw new Error("S03 capacity entry is missing");
  const ledgerText = await readFile(path.resolve(projectRoot, capacityEntry.ledgerArtifact), "utf8");
  const ledger = preallocationCapacityLedgerSchema.parse(JSON.parse(ledgerText));
  const expected = {
    sourceRegisterFingerprint: audit.sourceRegisterFingerprint,
    boundaryProtocolFingerprint: ledger.boundaryProtocolFingerprint,
    highRiskTaxonomyFingerprint: ledger.highRiskTaxonomyFingerprint,
    capacityManifestFingerprint: audit.capacityManifestFingerprint,
    capacityLedgerArtifactFingerprint: audit.capacityLedgerArtifactFingerprint,
    capacityLedgerFingerprint: audit.capacityLedgerFingerprint,
    samplingPlanV4OutcomeFingerprint: audit.samplingPlanV4OutcomeFingerprint,
    sourceContentFingerprint: ledger.sourceContentFingerprint,
    boundaryManifestFingerprint: ledger.boundaryManifestFingerprint,
    ledgerFingerprintMapFingerprint: ledger.ledgerFingerprintMapFingerprint,
  };
  if (amendment.auditFingerprint !== audit.auditFingerprint ||
      JSON.stringify(amendment.prerequisites) !== JSON.stringify(expected) ||
      JSON.stringify(amendment.counts) !== JSON.stringify(audit.counts) ||
      amendment.policy.equivalence !== audit.policy.equivalence ||
      amendment.policy.representative !== audit.policy.representative ||
      amendment.policy.consensusAdmission !== audit.policy.consensusAdmission ||
      amendment.policy.blindToFameQuotabilityAndTraitOutcome !==
        audit.policy.blindToFameQuotabilityAndTraitOutcome ||
      Date.parse(amendment.frozenAt) < Date.parse(audit.createdAt)) {
    throw new Error("S03 duplicate-overlap amendment prerequisites are stale");
  }
  return { ...amendment, amendmentFingerprint: digest(amendmentText) };
}

function validateReview(
  report: z.infer<typeof commonReviewSchema>,
  auditFingerprint: string,
  prerequisites: z.infer<typeof prerequisiteSchema>,
  counts: z.infer<typeof countSchema>,
): void {
  const reportPrerequisites = report.prerequisite_fingerprints;
  const required: Record<string, string> = {
    source_register_fingerprint: prerequisites.sourceRegisterFingerprint,
    boundary_protocol_fingerprint: prerequisites.boundaryProtocolFingerprint,
    high_risk_taxonomy_fingerprint: prerequisites.highRiskTaxonomyFingerprint,
    capacity_manifest_fingerprint: prerequisites.capacityManifestFingerprint,
    capacity_ledger_artifact_fingerprint: prerequisites.capacityLedgerArtifactFingerprint,
    capacity_ledger_fingerprint: prerequisites.capacityLedgerFingerprint,
    sampling_plan_v4_outcome_fingerprint: prerequisites.samplingPlanV4OutcomeFingerprint,
    source_content_fingerprint: prerequisites.sourceContentFingerprint,
    ledger_fingerprint_map_fingerprint: prerequisites.ledgerFingerprintMapFingerprint,
  };
  const boundary = reportPrerequisites.boundary_manifest_fingerprint ??
    reportPrerequisites.boundary_draft_fingerprint;
  if (report.audit_fingerprint !== auditFingerprint ||
      boundary !== prerequisites.boundaryManifestFingerprint ||
      Object.entries(required).some(([key, value]) => reportPrerequisites[key] !== value) ||
      JSON.stringify(normalizeCounts(report.counts)) !== JSON.stringify(counts)) {
    throw new Error(`${report.review_role} S03 duplicate-overlap review is stale`);
  }
}

function normalizeCounts(input: Record<string, number>): z.infer<typeof countSchema> {
  const value = (camel: string, snake: string) => input[camel] ?? input[snake];
  return countSchema.parse({
    eligibleOccurrences: value("eligibleOccurrences", "eligible_occurrences"),
    uniqueFingerprintGroups: value("uniqueFingerprintGroups", "unique_fingerprint_groups"),
    duplicateFingerprintGroups: value("duplicateFingerprintGroups", "duplicate_fingerprint_groups"),
    duplicateOccurrencesBeyondRepresentative: value(
      "duplicateOccurrencesBeyondRepresentative", "duplicate_occurrences_beyond_representative",
    ),
    cleanConsensusGroups: value("cleanConsensusGroups", "clean_consensus_groups"),
    uncertaintyWithheldGroups: value("uncertaintyWithheldGroups", "uncertainty_withheld_groups"),
    metadataConflictGroups: value("metadataConflictGroups", "metadata_conflict_groups"),
    groupsContainingPriorUncertainty: value(
      "groupsContainingPriorUncertainty", "groups_containing_prior_uncertainty",
    ),
    proposedAdmittedHighRiskGroups: value(
      "proposedAdmittedHighRiskGroups", "proposed_admitted_high_risk_groups",
    ),
  });
}

function freezeReview(report: z.infer<typeof commonReviewSchema>, text: string) {
  return {
    reviewRole: report.review_role,
    reportFingerprint: digest(text),
    reviewerId: report.reviewer.reviewer_id,
    tool: report.reviewer.tool,
    model: report.reviewer.model,
    reviewedAt: report.reviewer.reviewed_at,
    verdict: "pass" as const,
    discrepancyCount: 0 as const,
  };
}

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
