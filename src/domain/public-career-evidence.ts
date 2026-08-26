import { z } from "zod";

import { careerMaturitySchema } from "./career-evidence.js";

export const PUBLIC_CAREER_EVIDENCE_SCHEMA_VERSION = "1.0.0" as const;

const isoTimestampSchema = z.string().datetime({ offset: true });
const evidenceStrengthSchema = z.enum(["strong", "moderate", "limited"]);
const careerEvidenceIdSchema = z.string().regex(
  /^career:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
);
const publicSourceTypeSchema = z.enum([
  "resume",
  "employer_history",
  "recommendation",
  "project",
  "repository",
  "release_artifact",
  "portfolio_page",
  "confirmed_fact",
]);

export const publicCareerEvidenceManifestSchema = z.object({
  schemaVersion: z.literal(PUBLIC_CAREER_EVIDENCE_SCHEMA_VERSION),
  corpusVersion: z.string().regex(/^career:[a-f0-9]{64}$/),
  corpusHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  generatedAt: isoTimestampSchema,
  reviewedAt: isoTimestampSchema,
  evidenceCount: z.number().int().nonnegative(),
  revokedEvidenceIds: z.array(careerEvidenceIdSchema).refine(unique, {
    message: "Revoked evidence IDs must be unique.",
  }),
});

export const publicCareerEvidenceRecordSchema = z.object({
  evidenceId: careerEvidenceIdSchema,
  claim: z.object({
    claimId: z.string().uuid(),
    text: z.string().trim().min(1).max(4_000),
    evidenceIds: z.array(careerEvidenceIdSchema).length(1),
    evidenceStrength: evidenceStrengthSchema,
    maturity: careerMaturitySchema,
    limitations: z.array(z.string().trim().min(1).max(2_000)),
  }),
  citation: z.object({
    evidenceId: careerEvidenceIdSchema,
    title: z.string().trim().min(1).max(240),
    href: z.string().trim().min(1).max(2_000),
    sourceType: publicSourceTypeSchema,
    strength: evidenceStrengthSchema,
    maturity: careerMaturitySchema,
    lastReviewedAt: isoTimestampSchema,
  }),
}).superRefine((record, context) => {
  if (
    record.claim.evidenceIds[0] !== record.evidenceId ||
    record.citation.evidenceId !== record.evidenceId
  ) {
    context.addIssue({
      code: "custom",
      message: "Claim and citation evidence IDs must match the record ID.",
    });
  }
});

export const publicCareerEvidenceArtifactSchema = z.object({
  manifest: publicCareerEvidenceManifestSchema,
  evidence: z.array(publicCareerEvidenceRecordSchema),
}).superRefine((artifact, context) => {
  const evidenceIds = artifact.evidence.map((record) => record.evidenceId);
  if (new Set(evidenceIds).size !== evidenceIds.length) {
    context.addIssue({ code: "custom", message: "Evidence IDs must be unique." });
  }
  if (artifact.manifest.evidenceCount !== artifact.evidence.length) {
    context.addIssue({
      code: "custom",
      message: "Manifest evidence count must match the artifact.",
    });
  }
  if (artifact.manifest.revokedEvidenceIds.some((id) => evidenceIds.includes(id))) {
    context.addIssue({
      code: "custom",
      message: "Active and revoked evidence IDs must be disjoint.",
    });
  }
});

export type PublicCareerEvidenceManifest = z.infer<
  typeof publicCareerEvidenceManifestSchema
>;
export type PublicCareerEvidenceRecord = z.infer<
  typeof publicCareerEvidenceRecordSchema
>;
export type PublicCareerEvidenceArtifact = z.infer<
  typeof publicCareerEvidenceArtifactSchema
>;

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}
