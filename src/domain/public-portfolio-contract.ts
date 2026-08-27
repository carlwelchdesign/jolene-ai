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

const publicAnswerCitationSchema = z.object({
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
  citations: z.array(publicAnswerCitationSchema).max(
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

export type PortfolioAnswerRequest = z.infer<
  typeof portfolioAnswerRequestSchema
>;
export type PortfolioAnswerResponse = z.infer<
  typeof portfolioAnswerResponseSchema
>;
