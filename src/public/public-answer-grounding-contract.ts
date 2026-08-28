import { createHash } from "node:crypto";

import { z } from "zod";

import {
  careerEvidenceIdSchema,
  type PublicCareerEvidenceArtifact,
} from "../domain/public-career-evidence.js";
import {
  PUBLIC_PORTFOLIO_ANSWER_LIMITS,
  type PortfolioAnswerResponse,
} from "../domain/public-portfolio-contract.js";

export const PUBLIC_ANSWER_GROUNDING_CONTRACT_VERSION = "1.0.0" as const;

export const PUBLIC_ANSWER_GROUNDING_LIMITS = {
  segments: 8,
  segmentCharacters: 600,
  supportIdsPerSegment: PUBLIC_PORTFOLIO_ANSWER_LIMITS.responseItems,
  validationMilliseconds: 50,
} as const;

export const PUBLIC_ANSWER_GROUNDING_REASON_CODES = [
  "output_schema_invalid",
  "no_selected_evidence",
  "support_id_not_selected",
  "support_id_revoked",
  "support_id_conflicted",
  "unsupported_segment",
  "contribution_boundary_violation",
  "prohibited_claim",
  "prompt_or_policy_leakage",
  "identity_impersonation",
  "unauthorized_action_or_promise",
  "private_or_contact_disclosure",
  "corpus_version_mismatch",
  "validation_timeout",
  "validator_unavailable",
] as const;

export const publicAnswerGroundingReasonCodeSchema = z.enum(
  PUBLIC_ANSWER_GROUNDING_REASON_CODES,
);

export const publicAnswerGroundedSegmentSchema = z.object({
  text: z.string().trim().min(1).max(
    PUBLIC_ANSWER_GROUNDING_LIMITS.segmentCharacters,
  ),
  supportIds: z.array(careerEvidenceIdSchema).min(1).max(
    PUBLIC_ANSWER_GROUNDING_LIMITS.supportIdsPerSegment,
  ).refine(unique, { message: "Segment support IDs must be unique." }),
}).strict();

export const publicAnswerGroundedGenerationSchema = z.object({
  contractVersion: z.literal(PUBLIC_ANSWER_GROUNDING_CONTRACT_VERSION),
  corpusVersion: z.string().regex(/^career:[a-f0-9]{64}$/u),
  segments: z.array(publicAnswerGroundedSegmentSchema).min(1).max(
    PUBLIC_ANSWER_GROUNDING_LIMITS.segments,
  ),
}).strict();

const publicAnswerGroundingAcceptedSchema = z.object({
  status: z.literal("accepted"),
  contractVersion: z.literal(PUBLIC_ANSWER_GROUNDING_CONTRACT_VERSION),
  segmentCount: z.number().int().positive().max(
    PUBLIC_ANSWER_GROUNDING_LIMITS.segments,
  ),
  supportCount: z.number().int().positive().max(
    PUBLIC_ANSWER_GROUNDING_LIMITS.segments *
      PUBLIC_ANSWER_GROUNDING_LIMITS.supportIdsPerSegment,
  ),
  elapsedMilliseconds: z.number().int().nonnegative(),
}).strict();

const publicAnswerGroundingRejectedSchema = z.object({
  status: z.literal("rejected"),
  contractVersion: z.literal(PUBLIC_ANSWER_GROUNDING_CONTRACT_VERSION),
  reasonCode: publicAnswerGroundingReasonCodeSchema,
  segmentIndex: z.number().int().nonnegative().max(
    PUBLIC_ANSWER_GROUNDING_LIMITS.segments - 1,
  ).nullable(),
  elapsedMilliseconds: z.number().int().nonnegative(),
}).strict();

export const publicAnswerGroundingResultSchema = z.discriminatedUnion(
  "status",
  [publicAnswerGroundingAcceptedSchema, publicAnswerGroundingRejectedSchema],
);

export const PUBLIC_MODEL_MUTABLE_ANSWER_FIELDS = ["answer"] as const;

export interface PublicAnswerFallbackSnapshot {
  readonly schemaVersion: "1.0.0";
  readonly corpusVersion: string;
  readonly corpusHash: string;
  readonly revokedEvidenceIds: readonly string[];
  readonly responseDigest: `sha256:${string}`;
  readonly claimIds: readonly string[];
  readonly claimEvidenceIds: readonly string[];
  readonly citationEvidenceIds: readonly string[];
  readonly limitationDigest: `sha256:${string}`;
}

export function createPublicAnswerFallbackSnapshot(
  artifact: PublicCareerEvidenceArtifact,
  response: PortfolioAnswerResponse,
): PublicAnswerFallbackSnapshot {
  return {
    schemaVersion: artifact.manifest.schemaVersion,
    corpusVersion: artifact.manifest.corpusVersion,
    corpusHash: artifact.manifest.corpusHash,
    revokedEvidenceIds: [...artifact.manifest.revokedEvidenceIds].sort(),
    responseDigest: digest(response),
    claimIds: response.claims.map((claim) => claim.claimId),
    claimEvidenceIds: response.claims.flatMap((claim) => claim.evidenceIds),
    citationEvidenceIds: response.citations.map((citation) => citation.evidenceId),
    limitationDigest: digest({
      response: response.limitations,
      claims: response.claims.map((claim) => claim.limitations),
    }),
  };
}

export type PublicAnswerGroundedGeneration = z.infer<
  typeof publicAnswerGroundedGenerationSchema
>;
export type PublicAnswerGroundingReasonCode = z.infer<
  typeof publicAnswerGroundingReasonCodeSchema
>;
export type PublicAnswerGroundingResult = z.infer<
  typeof publicAnswerGroundingResultSchema
>;

function digest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}
