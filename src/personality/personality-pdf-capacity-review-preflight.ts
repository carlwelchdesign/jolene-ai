import { createHash } from "node:crypto";

import { parse } from "yaml";
import { z } from "zod";

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const reviewSchema = z.object({
  fingerprint: sha256Schema, reviewer_id: z.string(), reviewer_type: z.literal("ai"),
  tool: z.string(), model_version: z.string(), reviewed_at: z.string().datetime(),
  all_eligible_units_reviewed: z.literal(140), source_content_stored: z.literal(false),
}).strict();
const evidenceSchema = z.object({
  schema_version: z.literal("personality-pdf-capacity-review-evidence-v1"),
  created_at: z.string().datetime(), source_register_fingerprint: sha256Schema,
  boundary_protocol_fingerprint: sha256Schema,
  high_risk_taxonomy_fingerprint: sha256Schema,
  s04_cue_amendment_fingerprint: sha256Schema,
  primary_review: reviewSchema, independent_review: reviewSchema,
}).passthrough();
const primarySchema = z.object({
  reviewer_id: z.string(), completed_at_utc: z.string().datetime(), tool: z.string(),
  model: z.array(z.string()).min(1), source_content_stored: z.literal(false),
}).passthrough();
const independentSchema = z.object({
  completed_at: z.string().datetime(),
  reviewer: z.object({ reviewer_id: z.string(), tool: z.string(), model: z.string() })
    .passthrough(),
  source_content_stored: z.boolean().optional(),
  rights_audit: z.object({ source_content_persisted: z.literal(false) }).passthrough(),
}).passthrough();

export interface PdfReviewPrerequisites {
  readonly sourceRegisterFingerprint: string;
  readonly boundaryProtocolFingerprint: string;
  readonly highRiskTaxonomyFingerprint: string;
  readonly s04CueAmendmentFingerprint: string;
}

export function preflightPersonalityPdfCapacityReviews(
  primaryText: string,
  independentText: string,
  evidenceText: string,
  prerequisites: PdfReviewPrerequisites,
) {
  const evidence = evidenceSchema.parse(parse(evidenceText));
  const primary = primarySchema.parse(JSON.parse(primaryText));
  const independent = independentSchema.parse(JSON.parse(independentText));
  if (evidence.primary_review.fingerprint !== digest(primaryText) ||
      evidence.independent_review.fingerprint !== digest(independentText) ||
      evidence.primary_review.reviewer_id !== primary.reviewer_id ||
      evidence.primary_review.tool !== primary.tool ||
      evidence.primary_review.model_version !== primary.model.join(",") ||
      evidence.primary_review.reviewed_at !== primary.completed_at_utc ||
      evidence.independent_review.reviewer_id !== independent.reviewer.reviewer_id ||
      evidence.independent_review.tool !== independent.reviewer.tool ||
      evidence.independent_review.model_version !== independent.reviewer.model ||
      evidence.independent_review.reviewed_at !== independent.completed_at ||
      evidence.source_register_fingerprint !== prerequisites.sourceRegisterFingerprint ||
      evidence.boundary_protocol_fingerprint !== prerequisites.boundaryProtocolFingerprint ||
      evidence.high_risk_taxonomy_fingerprint !== prerequisites.highRiskTaxonomyFingerprint ||
      evidence.s04_cue_amendment_fingerprint !== prerequisites.s04CueAmendmentFingerprint ||
      Date.parse(evidence.created_at) < Date.parse(primary.completed_at_utc) ||
      Date.parse(evidence.created_at) < Date.parse(independent.completed_at)) {
    throw new Error("PDF review inputs do not match frozen review evidence");
  }
  return { evidence, primaryReviewFingerprint: digest(primaryText),
    independentReviewFingerprint: digest(independentText) };
}

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
