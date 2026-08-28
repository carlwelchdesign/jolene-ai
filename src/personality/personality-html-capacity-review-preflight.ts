import { createHash } from "node:crypto";

import { parse } from "yaml";
import { z } from "zod";

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const sourceIdSchema = z.enum(["S02", "S03", "S05", "S13", "S19", "S20"]);
const evidenceReviewSchema = z.object({
  fingerprint: sha256Schema,
  reviewer_id: z.string(),
  reviewer_type: z.literal("ai"),
  tool: z.string(),
  model_version: z.string(),
  reviewed_at: z.string().datetime(),
  all_eligible_units_reviewed: z.literal(448),
  source_content_stored: z.literal(false),
}).strict();
const evidenceSchema = z.object({
  schema_version: z.literal("personality-html-capacity-review-evidence-v1"),
  created_at: z.string().datetime(),
  source_register_fingerprint: sha256Schema,
  boundary_protocol_fingerprint: sha256Schema,
  high_risk_taxonomy_fingerprint: sha256Schema,
  primary_review: evidenceReviewSchema,
  independent_review: evidenceReviewSchema,
}).passthrough();
const reportSchema = z.object({
  schema_version: z.literal("personality-html-capacity-review-v1"),
  review_role: z.enum(["primary", "independent"]),
  reviewer: z.object({
    reviewer_id: z.string(), tool: z.string(),
    model: z.union([z.string(), z.array(z.string()).min(1)]),
    reviewed_at: z.string().datetime(),
  }).strict(),
  source_register_fingerprint: sha256Schema,
  boundary_protocol_fingerprint: sha256Schema,
  high_risk_taxonomy_fingerprint: sha256Schema,
  eligible_units_reviewed: z.literal(448),
  rights_audit: z.object({ source_content_persisted: z.literal(false) }).passthrough(),
}).passthrough();

export interface HtmlReviewPrerequisites {
  readonly sourceRegisterFingerprint: string;
  readonly boundaryProtocolFingerprint: string;
  readonly highRiskTaxonomyFingerprint: string;
}

export function preflightPersonalityHtmlCapacityReviews(
  primaryText: string,
  independentText: string,
  evidenceText: string,
  prerequisites: HtmlReviewPrerequisites,
) {
  const evidence = evidenceSchema.parse(parse(evidenceText));
  const primary = reportSchema.parse(JSON.parse(primaryText));
  const independent = reportSchema.parse(JSON.parse(independentText));
  if (primary.review_role !== "primary" || independent.review_role !== "independent" ||
      primary.reviewer.reviewer_id === independent.reviewer.reviewer_id ||
      evidence.primary_review.fingerprint !== digest(primaryText) ||
      evidence.independent_review.fingerprint !== digest(independentText) ||
      !matchesEvidence(evidence.primary_review, primary) ||
      !matchesEvidence(evidence.independent_review, independent) ||
      evidence.source_register_fingerprint !== prerequisites.sourceRegisterFingerprint ||
      evidence.boundary_protocol_fingerprint !== prerequisites.boundaryProtocolFingerprint ||
      evidence.high_risk_taxonomy_fingerprint !== prerequisites.highRiskTaxonomyFingerprint ||
      primary.source_register_fingerprint !== prerequisites.sourceRegisterFingerprint ||
      independent.source_register_fingerprint !== prerequisites.sourceRegisterFingerprint ||
      primary.boundary_protocol_fingerprint !== prerequisites.boundaryProtocolFingerprint ||
      independent.boundary_protocol_fingerprint !== prerequisites.boundaryProtocolFingerprint ||
      primary.high_risk_taxonomy_fingerprint !== prerequisites.highRiskTaxonomyFingerprint ||
      independent.high_risk_taxonomy_fingerprint !== prerequisites.highRiskTaxonomyFingerprint ||
      Date.parse(evidence.created_at) < Date.parse(primary.reviewer.reviewed_at) ||
      Date.parse(evidence.created_at) < Date.parse(independent.reviewer.reviewed_at)) {
    throw new Error("HTML review inputs do not match frozen review evidence");
  }
  return {
    evidence,
    primaryReviewFingerprint: digest(primaryText),
    independentReviewFingerprint: digest(independentText),
  };
}

function matchesEvidence(
  evidence: z.infer<typeof evidenceReviewSchema>,
  report: z.infer<typeof reportSchema>,
) {
  return evidence.reviewer_id === report.reviewer.reviewer_id &&
    evidence.tool === report.reviewer.tool &&
    evidence.model_version === modelVersion(report.reviewer.model) &&
    evidence.reviewed_at === report.reviewer.reviewed_at;
}

function modelVersion(model: string | readonly string[]) {
  return typeof model === "string" ? model : model.join(",");
}

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
