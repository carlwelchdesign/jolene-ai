import { z } from "zod";

import { careerMaturitySchema } from "./career-evidence.js";
import {
  PUBLIC_CAREER_EVIDENCE_SCHEMA_VERSION,
  careerEvidenceIdSchema,
  evidenceStrengthSchema,
  publicSourceTypeSchema,
} from "./public-career-evidence.js";

export const PUBLIC_PORTFOLIO_ANSWER_LIMITS = {
  questionCharacters: 800,
  sessionTokenCharacters: 256,
  responseItems: 5,
} as const;

export const PUBLIC_PORTFOLIO_JOB_FIT_LIMITS = {
  jobDescriptionCharacters: 12_000,
  requirements: 24,
  requirementCharacters: 600,
  evidencePerRequirement: 3,
  citations: 72,
  sessionTokenCharacters: 256,
} as const;

export const portfolioAnswerRequestSchema = z.object({
  question: z.string().trim().min(1).max(
    PUBLIC_PORTFOLIO_ANSWER_LIMITS.questionCharacters,
  ),
  sessionToken: z.string().trim().min(1).max(
    PUBLIC_PORTFOLIO_ANSWER_LIMITS.sessionTokenCharacters,
  ).optional(),
}).strict();

const publicAnswerClaimSchema = z.object({
  claimId: z.string().uuid(),
  text: z.string().trim().min(1).max(4_000),
  evidenceIds: z.array(careerEvidenceIdSchema).min(1).max(
    PUBLIC_PORTFOLIO_ANSWER_LIMITS.responseItems,
  ),
  evidenceStrength: evidenceStrengthSchema,
  maturity: careerMaturitySchema,
  limitations: z.array(z.string().trim().min(1).max(2_000)),
});

export const publicEvidenceCitationSchema = z.object({
  evidenceId: careerEvidenceIdSchema,
  title: z.string().trim().min(1).max(240),
  href: z.string().trim().min(1).max(2_000),
  sourceType: publicSourceTypeSchema,
  strength: evidenceStrengthSchema,
  maturity: careerMaturitySchema,
  lastReviewedAt: z.string().datetime({ offset: true }),
});

export const portfolioAnswerResponseSchema = z.object({
  schemaVersion: z.literal(PUBLIC_CAREER_EVIDENCE_SCHEMA_VERSION),
  answer: z.string().trim().min(1),
  claims: z.array(publicAnswerClaimSchema).max(
    PUBLIC_PORTFOLIO_ANSWER_LIMITS.responseItems,
  ),
  citations: z.array(publicEvidenceCitationSchema).max(
    PUBLIC_PORTFOLIO_ANSWER_LIMITS.responseItems,
  ),
  limitations: z.array(z.string().trim().min(1).max(2_000)),
  suggestedFollowUpQuestions: z.array(z.string().trim().min(1).max(240)).max(4),
  corpusVersion: z.string().regex(/^career:[a-f0-9]{64}$/),
  sessionToken: z.string().trim().min(1).max(
    PUBLIC_PORTFOLIO_ANSWER_LIMITS.sessionTokenCharacters,
  ).optional(),
}).superRefine((response, context) => {
  const citationIds = new Set(
    response.citations.map((citation) => citation.evidenceId),
  );
  if (citationIds.size !== response.citations.length) {
    context.addIssue({ code: "custom", message: "Citation IDs must be unique." });
  }
  if (new Set(response.claims.map((claim) => claim.claimId)).size !==
      response.claims.length) {
    context.addIssue({ code: "custom", message: "Claim IDs must be unique." });
  }
  for (const claim of response.claims) {
    if (claim.evidenceIds.some((id) => !citationIds.has(id))) {
      context.addIssue({
        code: "custom",
        message: "Every claim evidence ID must resolve to a returned citation.",
      });
    }
  }
});

export const portfolioJobFitRequestSchema = z.object({
  jobDescription: z.string().trim().min(1).max(
    PUBLIC_PORTFOLIO_JOB_FIT_LIMITS.jobDescriptionCharacters,
  ).refine((value) => /[\p{L}\p{N}]/u.test(value), {
    message: "Job description must contain a letter or number.",
  }),
  sessionToken: z.string().trim().min(1).max(
    PUBLIC_PORTFOLIO_JOB_FIT_LIMITS.sessionTokenCharacters,
  ).optional(),
}).strict();

export const jobFitAssessmentSchema = z.enum([
  "direct",
  "adjacent",
  "missing",
  "unknown",
]);

const jobRequirementResultSchema = z.object({
  requirementId: z.string().regex(/^req:[a-f0-9]{16}$/),
  requirement: z.string().trim().min(1).max(
    PUBLIC_PORTFOLIO_JOB_FIT_LIMITS.requirementCharacters,
  ),
  assessment: jobFitAssessmentSchema,
  explanation: z.string().trim().min(1).max(2_000),
  evidenceIds: z.array(careerEvidenceIdSchema).max(
    PUBLIC_PORTFOLIO_JOB_FIT_LIMITS.evidencePerRequirement,
  ),
  limitations: z.array(z.string().trim().min(1).max(2_000)).max(4),
}).superRefine((result, context) => {
  if (
    (result.assessment === "direct" || result.assessment === "adjacent") &&
    result.evidenceIds.length === 0
  ) {
    context.addIssue({
      code: "custom",
      message: "Supported assessments require at least one evidence ID.",
    });
  }
});

export const portfolioJobFitResponseSchema = z.object({
  schemaVersion: z.literal(PUBLIC_CAREER_EVIDENCE_SCHEMA_VERSION),
  requirements: z.array(jobRequirementResultSchema).min(1).max(
    PUBLIC_PORTFOLIO_JOB_FIT_LIMITS.requirements,
  ),
  citations: z.array(publicEvidenceCitationSchema).max(
    PUBLIC_PORTFOLIO_JOB_FIT_LIMITS.citations,
  ),
  caveats: z.array(z.string().trim().min(1).max(2_000)).min(1).max(8),
  suggestedFollowUpQuestions: z.array(z.string().trim().min(1).max(240)).max(4),
  corpusVersion: z.string().regex(/^career:[a-f0-9]{64}$/),
  sessionToken: z.string().trim().min(1).max(
    PUBLIC_PORTFOLIO_JOB_FIT_LIMITS.sessionTokenCharacters,
  ).optional(),
}).superRefine((response, context) => {
  const citationIds = new Set(
    response.citations.map((citation) => citation.evidenceId),
  );
  if (citationIds.size !== response.citations.length) {
    context.addIssue({ code: "custom", message: "Citation IDs must be unique." });
  }
  if (
    new Set(response.requirements.map((result) => result.requirementId)).size !==
      response.requirements.length
  ) {
    context.addIssue({
      code: "custom",
      message: "Requirement IDs must be unique.",
    });
  }
  for (const result of response.requirements) {
    if (result.evidenceIds.some((id) => !citationIds.has(id))) {
      context.addIssue({
        code: "custom",
        message: "Every requirement evidence ID must resolve to a citation.",
      });
    }
  }
});

export type PortfolioAnswerRequest = z.infer<
  typeof portfolioAnswerRequestSchema
>;
export type PortfolioAnswerResponse = z.infer<
  typeof portfolioAnswerResponseSchema
>;
export type PortfolioJobFitRequest = z.infer<
  typeof portfolioJobFitRequestSchema
>;
export type PortfolioJobFitResponse = z.infer<
  typeof portfolioJobFitResponseSchema
>;
