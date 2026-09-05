import { z } from "zod";

import { careerMaturitySchema } from "./career-evidence.js";
import {
  PUBLIC_CAREER_EVIDENCE_SCHEMA_VERSION,
  careerEvidenceIdSchema,
  evidenceStrengthSchema,
  publicSourceTypeSchema,
  siteRelativePublicHrefSchema,
} from "./public-career-evidence.js";

export const PUBLIC_PORTFOLIO_ANSWER_LIMITS = {
  questionCharacters: 800,
  answerCharacters: 4_000,
  responseItems: 5,
  responseLimitations: 8,
  claimLimitations: 8,
} as const;

export const PUBLIC_CONVERSATION_CONTEXT_LIMITS = {
  turns: 4,
  lifetimeSeconds: 15 * 60,
} as const;

export const publicConversationResponseBeatSchema = z.enum([
  "contextual_spark",
  "story_turn",
  "candid_directness",
  "quiet_care",
  "none",
]);

export const PUBLIC_PORTFOLIO_JOB_FIT_LIMITS = {
  jobDescriptionCharacters: 12_000,
  requirements: 24,
  requirementCharacters: 600,
  evidencePerRequirement: 3,
  citations: 72,
  caveats: 8,
} as const;

export const PUBLIC_CONTACT_INTENT_LIMITS = {
  nameCharacters: 100,
  emailCharacters: 254,
  organizationCharacters: 120,
  messageCharacters: 2_000,
} as const;

export const PUBLIC_JOLENE_ERROR_CODES = [
  "invalid_request",
  "unavailable",
  "rate_limited",
  "budget_exhausted",
  "version_mismatch",
  "request_rejected",
] as const;

export const PUBLIC_JOLENE_ERROR_LIMITS = {
  messageCharacters: 240,
  supportedSchemaVersions: 4,
} as const;

export const publicConversationContextSchema = z.object({
  corpusVersion: z.string().regex(/^career:[a-f0-9]{64}$/),
  projectPath: siteRelativePublicHrefSchema.refine(
    (value) => /^\/work\/[a-z0-9-]+$/u.test(value),
    { message: "Conversation project path must identify a published work page." },
  ).optional(),
  evidenceIds: z.array(careerEvidenceIdSchema).min(1).max(
    PUBLIC_PORTFOLIO_ANSWER_LIMITS.responseItems,
  ).optional(),
  // This contains only a bounded, approved response-movement handle. It is
  // never a transcript, visitor profile, or generated sentence.
  responseBeat: publicConversationResponseBeatSchema.optional(),
  turnCount: z.number().int().min(1).max(
    PUBLIC_CONVERSATION_CONTEXT_LIMITS.turns,
  ),
  expiresAt: z.string().datetime({ offset: true }),
}).strict().refine(
  (context) => Boolean(context.projectPath || context.evidenceIds?.length),
  { message: "Conversation context must contain a public project or evidence anchor." },
);

export const portfolioAnswerRequestSchema = z.object({
  question: z.string().trim().min(1).max(
    PUBLIC_PORTFOLIO_ANSWER_LIMITS.questionCharacters,
  ),
  conversationContext: publicConversationContextSchema.optional(),
}).strict();

const publicAnswerClaimSchema = z.object({
  claimId: z.string().uuid(),
  text: z.string().trim().min(1).max(4_000),
  evidenceIds: z.array(careerEvidenceIdSchema).min(1).max(
    PUBLIC_PORTFOLIO_ANSWER_LIMITS.responseItems,
  ),
  evidenceStrength: evidenceStrengthSchema,
  maturity: careerMaturitySchema,
  limitations: z.array(z.string().trim().min(1).max(2_000)).max(
    PUBLIC_PORTFOLIO_ANSWER_LIMITS.claimLimitations,
  ),
}).strict();

export const publicEvidenceCitationSchema = z.object({
  evidenceId: careerEvidenceIdSchema,
  title: z.string().trim().min(1).max(240),
  href: siteRelativePublicHrefSchema,
  sourceType: publicSourceTypeSchema,
  strength: evidenceStrengthSchema,
  maturity: careerMaturitySchema,
  lastReviewedAt: z.string().datetime({ offset: true }),
}).strict();

export const portfolioAnswerResponseSchema = z.object({
  schemaVersion: z.literal(PUBLIC_CAREER_EVIDENCE_SCHEMA_VERSION),
  answer: z.string().trim().min(1).max(
    PUBLIC_PORTFOLIO_ANSWER_LIMITS.answerCharacters,
  ),
  claims: z.array(publicAnswerClaimSchema).max(
    PUBLIC_PORTFOLIO_ANSWER_LIMITS.responseItems,
  ),
  citations: z.array(publicEvidenceCitationSchema).max(
    PUBLIC_PORTFOLIO_ANSWER_LIMITS.responseItems,
  ),
  limitations: z.array(z.string().trim().min(1).max(2_000)).max(
    PUBLIC_PORTFOLIO_ANSWER_LIMITS.responseLimitations,
  ),
  suggestedFollowUpQuestions: z.array(z.string().trim().min(1).max(240)).max(4),
  corpusVersion: z.string().regex(/^career:[a-f0-9]{64}$/),
  conversationContext: publicConversationContextSchema.optional(),
}).strict().superRefine((response, context) => {
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
  if (
    response.conversationContext &&
    response.conversationContext.corpusVersion !== response.corpusVersion
  ) {
    context.addIssue({
      code: "custom",
      path: ["conversationContext", "corpusVersion"],
      message: "Conversation context must use the response corpus version.",
    });
  }
});

export const portfolioJobFitRequestSchema = z.object({
  jobDescription: z.string().trim().min(1).max(
    PUBLIC_PORTFOLIO_JOB_FIT_LIMITS.jobDescriptionCharacters,
  ).refine((value) => /[\p{L}\p{N}]/u.test(value), {
    message: "Job description must contain a letter or number.",
  }),
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
}).strict().superRefine((result, context) => {
  if (
    (result.assessment === "direct" || result.assessment === "adjacent") &&
    result.evidenceIds.length === 0
  ) {
    context.addIssue({
      code: "custom",
      message: "Supported assessments require at least one evidence ID.",
    });
  }
  if (
    (result.assessment === "missing" || result.assessment === "unknown") &&
    result.evidenceIds.length > 0
  ) {
    context.addIssue({
      code: "custom",
      path: ["evidenceIds"],
      message: "Missing and unknown assessments cannot cite evidence.",
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
  caveats: z.array(z.string().trim().min(1).max(2_000)).min(1).max(
    PUBLIC_PORTFOLIO_JOB_FIT_LIMITS.caveats,
  ),
  suggestedFollowUpQuestions: z.array(z.string().trim().min(1).max(240)).max(4),
  corpusVersion: z.string().regex(/^career:[a-f0-9]{64}$/),
}).strict().superRefine((response, context) => {
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

export const contactIntentRequestSchema = z.object({
  name: z.string().trim().min(1).max(PUBLIC_CONTACT_INTENT_LIMITS.nameCharacters),
  email: z.string().trim().max(PUBLIC_CONTACT_INTENT_LIMITS.emailCharacters)
    .pipe(z.email()),
  organization: z.string().trim().min(1).max(
    PUBLIC_CONTACT_INTENT_LIMITS.organizationCharacters,
  ).optional(),
  message: z.string().trim().min(1).max(
    PUBLIC_CONTACT_INTENT_LIMITS.messageCharacters,
  ).refine((value) => !containsLikelySecret(value), {
    message: "Contact messages cannot contain likely credentials or secrets.",
  }),
  consent: z.literal(true),
}).strict();

export const contactIntentResponseSchema = z.object({
  schemaVersion: z.literal(PUBLIC_CAREER_EVIDENCE_SCHEMA_VERSION),
  intentId: z.string().uuid(),
  status: z.literal("pending_review"),
  submittedAt: z.string().datetime({ offset: true }),
  message: z.string().trim().min(1).max(1_000),
}).strict();

export const publicJoleneErrorResponseSchema = z.object({
  schemaVersion: z.literal(PUBLIC_CAREER_EVIDENCE_SCHEMA_VERSION),
  code: z.enum(PUBLIC_JOLENE_ERROR_CODES),
  message: z.string().trim().min(1).max(
    PUBLIC_JOLENE_ERROR_LIMITS.messageCharacters,
  ),
  requestId: z.string().regex(/^req:[a-f0-9]{32}$/),
  retryAfterSeconds: z.number().int().positive().optional(),
  supportedSchemaVersions: z.array(z.string().trim().min(1)).max(
    PUBLIC_JOLENE_ERROR_LIMITS.supportedSchemaVersions,
  ).refine((versions) => new Set(versions).size === versions.length, {
    message: "Supported schema versions must be unique.",
  }).optional(),
}).strict().superRefine((response, context) => {
  if (
    response.code === "version_mismatch" &&
    !response.supportedSchemaVersions?.includes(
      PUBLIC_CAREER_EVIDENCE_SCHEMA_VERSION,
    )
  ) {
    context.addIssue({
      code: "custom",
      path: ["supportedSchemaVersions"],
      message: "Version mismatch errors must advertise the current schema.",
    });
  }
});

export type PortfolioAnswerRequest = z.infer<
  typeof portfolioAnswerRequestSchema
>;
export type PublicConversationContext = z.infer<
  typeof publicConversationContextSchema
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
export type ContactIntentRequest = z.infer<typeof contactIntentRequestSchema>;
export type ContactIntentResponse = z.infer<typeof contactIntentResponseSchema>;
export type PublicJoleneErrorCode = typeof PUBLIC_JOLENE_ERROR_CODES[number];
export type PublicJoleneErrorResponse = z.infer<
  typeof publicJoleneErrorResponseSchema
>;

export function containsLikelySecret(value: string): boolean {
  return LIKELY_SECRET_PATTERNS.some((pattern) => pattern.test(value));
}

const LIKELY_SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{20,}\b/u,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/u,
  /\bAKIA[A-Z0-9]{16}\b/u,
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/u,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
] as const;
