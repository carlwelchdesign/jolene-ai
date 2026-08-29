import { tokenizeLexicalTerms } from "../domain/lexical-terms.js";
import type {
  PublicCareerEvidenceArtifact,
  PublicCareerEvidenceRecord,
} from "../domain/public-career-evidence.js";
import type { PortfolioAnswerResponse } from
  "../domain/public-portfolio-contract.js";
import {
  createPublicAnswerFallbackSnapshot,
  PUBLIC_ANSWER_GROUNDING_CONTRACT_VERSION,
  PUBLIC_ANSWER_GROUNDING_LIMITS,
  publicAnswerGroundedGenerationSchema,
  type PublicAnswerGroundingReasonCode,
  type PublicAnswerGroundingResult,
} from "./public-answer-grounding-contract.js";

export type PublicAnswerGroundingValidation =
  | { readonly status: "accepted"; readonly answer: string; readonly audit: PublicAnswerGroundingResult }
  | { readonly status: "rejected"; readonly audit: PublicAnswerGroundingResult };

export interface PublicAnswerGroundingValidatorLike {
  validate(
    artifact: PublicCareerEvidenceArtifact,
    baseline: PortfolioAnswerResponse,
    generation: unknown,
  ): PublicAnswerGroundingValidation;
}

export class PublicAnswerGroundingValidator
  implements PublicAnswerGroundingValidatorLike
{
  validate(
    artifact: PublicCareerEvidenceArtifact,
    baseline: PortfolioAnswerResponse,
    generation: unknown,
  ): PublicAnswerGroundingValidation {
    const startedAt = performance.now();
    const parsed = publicAnswerGroundedGenerationSchema.safeParse(generation);
    if (!parsed.success) return rejected("output_schema_invalid", null, startedAt);
    if (baseline.claims.length === 0) {
      return rejected("no_selected_evidence", null, startedAt);
    }
    if (
      parsed.data.corpusVersion !== artifact.manifest.corpusVersion ||
      parsed.data.corpusVersion !== baseline.corpusVersion
    ) {
      return rejected("corpus_version_mismatch", null, startedAt);
    }

    const selectedIds = new Set(baseline.citations.map((item) => item.evidenceId));
    const active = new Map(artifact.evidence.map((item) => [item.evidenceId, item]));
    const revoked = new Set(artifact.manifest.revokedEvidenceIds);
    const conflicted = new Set(artifact.conflicts.flatMap((item) => item.evidenceIds));

    for (const [index, segment] of parsed.data.segments.entries()) {
      if (elapsed(startedAt) > PUBLIC_ANSWER_GROUNDING_LIMITS.validationMilliseconds) {
        return rejected("validation_timeout", index, startedAt);
      }
      if (materialSentenceCount(segment.text) !== 1) {
        return rejected("unsupported_segment", index, startedAt);
      }
      for (const supportId of segment.supportIds) {
        if (!selectedIds.has(supportId)) {
          return rejected("support_id_not_selected", index, startedAt);
        }
        if (revoked.has(supportId)) {
          return rejected("support_id_revoked", index, startedAt);
        }
        if (!active.has(supportId)) {
          return rejected("support_id_not_selected", index, startedAt);
        }
        if (conflicted.has(supportId)) {
          return rejected("support_id_conflicted", index, startedAt);
        }
      }
      const records = segment.supportIds.map((id) => active.get(id)!);
      const prohibited = prohibitedReason(segment.text, records);
      if (prohibited) return rejected(prohibited, index, startedAt);
      const entailmentFailure = validateEntailment(segment.text, records);
      if (entailmentFailure) return rejected(entailmentFailure, index, startedAt);
    }

    const answer = parsed.data.segments.map((segment) => segment.text).join("\n\n");
    const candidate = { ...baseline, answer };
    const baselineSnapshot = createPublicAnswerFallbackSnapshot(artifact, baseline);
    const candidateSnapshot = createPublicAnswerFallbackSnapshot(artifact, {
      ...candidate,
      answer: baseline.answer,
    });
    if (JSON.stringify(candidateSnapshot) !== JSON.stringify(baselineSnapshot)) {
      return rejected("validator_unavailable", null, startedAt);
    }
    const duration = elapsed(startedAt);
    if (duration > PUBLIC_ANSWER_GROUNDING_LIMITS.validationMilliseconds) {
      return rejected("validation_timeout", null, startedAt);
    }
    return {
      status: "accepted",
      answer,
      audit: {
        status: "accepted",
        contractVersion: PUBLIC_ANSWER_GROUNDING_CONTRACT_VERSION,
        segmentCount: parsed.data.segments.length,
        supportCount: parsed.data.segments.reduce(
          (total, segment) => total + segment.supportIds.length,
          0,
        ),
        elapsedMilliseconds: duration,
      },
    };
  }
}

function validateEntailment(
  text: string,
  records: readonly PublicCareerEvidenceRecord[],
): PublicAnswerGroundingReasonCode | null {
  const terms = materialTerms(text);
  if (terms.length < 2) return "unsupported_segment";
  const numbers = text.match(/\b\d+(?:[.,]\d+)?%?\b/gu) ?? [];
  const normalizedText = normalize(text);
  const hasNegation = /\b(?:no|not|never|without)\b/u.test(normalizedText);

  let supported = false;
  for (const record of records) {
    const sourceText = [
      record.claim.text,
      ...record.claim.limitations,
      record.citation.title,
    ].join(" ");
    const sourceTerms = new Set(materialTerms(sourceText));
    const overlap = terms.filter((term) => sourceTerms.has(term)).length;
    const coverage = overlap / terms.length;
    const sourceNormalized = normalize(sourceText);
    const boundaryMatches = CONTRIBUTION_BOUNDARY_TERMS.every((term) =>
      !containsTerm(normalizedText, term) || containsTerm(sourceNormalized, term)
    );
    if (!boundaryMatches) continue;
    const numbersMatch = numbers.every((number) => sourceNormalized.includes(number));
    const negationMatches = !hasNegation ||
      /\b(?:no|not|never|without)\b/u.test(sourceNormalized) ||
      (
        BOUNDARY_SEPARATION_PATTERN.test(normalizedText) &&
        BOUNDARY_SEPARATION_PATTERN.test(sourceNormalized)
      );
    if (overlap >= 2 && coverage >= 0.5 && numbersMatch && negationMatches) {
      supported = true;
    }
  }
  if (!supported && CONTRIBUTION_BOUNDARY_TERMS.some((term) =>
    containsTerm(normalizedText, term) && !records.some((record) => containsTerm(normalize([
      record.claim.text,
      ...record.claim.limitations,
      record.citation.title,
    ].join(" ")), term))
  )) return "contribution_boundary_violation";
  if (!supported) return "unsupported_segment";

  for (const record of records) {
    const sourceTerms = new Set(materialTerms([
      record.claim.text,
      ...record.claim.limitations,
      record.citation.title,
    ].join(" ")));
    if (terms.filter((term) => sourceTerms.has(term)).length < 2) {
      return "support_substitution";
    }
  }
  return null;
}

function prohibitedReason(
  text: string,
  records: readonly PublicCareerEvidenceRecord[],
): PublicAnswerGroundingReasonCode | null {
  const normalized = securityNormalize(text);
  if (hasAlternateEncoding(text)) return "prompt_or_policy_leakage";
  for (const [reason, patterns] of PROHIBITED_PATTERNS) {
    if (
      reason === "private_or_contact_disclosure" &&
      isSupportedNegativePrivacyBoundary(normalized, records)
    ) continue;
    if (patterns.some((pattern) => pattern.test(normalized))) return reason;
  }
  return null;
}

function isSupportedNegativePrivacyBoundary(
  normalizedText: string,
  records: readonly PublicCareerEvidenceRecord[],
): boolean {
  if (ALWAYS_PRIVATE_VALUE_PATTERNS.some((pattern) => pattern.test(normalizedText))) {
    return false;
  }
  const mentionedTerms = SENSITIVE_BOUNDARY_TERMS.filter((term) =>
    containsTerm(normalizedText, term)
  );
  if (mentionedTerms.length === 0 || !NEGATIVE_BOUNDARY_PATTERN.test(normalizedText)) {
    return false;
  }
  return mentionedTerms.every((term) => records.some((record) => {
    const source = normalize([
      record.claim.text,
      ...record.claim.limitations,
      record.citation.title,
    ].join(" "));
    return containsTerm(source, term) && NEGATIVE_BOUNDARY_PATTERN.test(source);
  }));
}

function securityNormalize(value: string): string {
  return value.toLocaleLowerCase("en-US").normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/[^a-z0-9%@+./:_-]+/gu, " ").trim();
}

function hasAlternateEncoding(value: string): boolean {
  return value !== value.normalize("NFKC") ||
    /%(?:[0-9a-f]{2})|&#(?:x[0-9a-f]+|\d+);|\\u[0-9a-f]{4}|(?:[A-Za-z0-9+/]{24,}={1,2})/iu.test(value);
}

function rejected(
  reasonCode: PublicAnswerGroundingReasonCode,
  segmentIndex: number | null,
  startedAt: number,
): PublicAnswerGroundingValidation {
  return {
    status: "rejected",
    audit: {
      status: "rejected",
      contractVersion: PUBLIC_ANSWER_GROUNDING_CONTRACT_VERSION,
      reasonCode,
      segmentIndex,
      elapsedMilliseconds: elapsed(startedAt),
    },
  };
}

function elapsed(startedAt: number): number {
  return Math.max(0, Math.ceil(performance.now() - startedAt));
}

function materialTerms(value: string): string[] {
  return [...new Set(tokenizeLexicalTerms(value).filter((term) =>
    !GROUNDING_STOP_WORDS.has(term)
  ))];
}

function normalize(value: string): string {
  return value.toLocaleLowerCase("en-US").normalize("NFKC")
    .replace(/[^a-z0-9%]+/gu, " ").trim();
}

function materialSentenceCount(value: string): number {
  const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
  return [...segmenter.segment(value)]
    .filter((item) => /[\p{L}\p{N}]/u.test(item.segment)).length;
}

const GROUNDING_STOP_WORDS = new Set([
  "a", "about", "also", "an", "and", "are", "as", "at", "be", "because",
  "been", "but", "by", "carl", "does", "evidence", "for", "from", "has",
  "have", "he", "his", "in", "into", "is", "it", "its", "of", "on", "or",
  "reviewed", "that", "the", "their", "this", "to", "was", "were", "which",
  "with", "work",
]);

const CONTRIBUTION_BOUNDARY_TERMS = [
  "sole", "solely", "independently", "led", "owned",
  "employer", "employed", "client", "award", "won",
] as const;

const SENSITIVE_BOUNDARY_TERMS = [
  "obsidian",
  "private memory",
  "sqlite",
  "api key",
  "token",
  "password",
] as const;

const NEGATIVE_BOUNDARY_PATTERN =
  /\b(?:cannot|can't|does not|doesn't|never|no|not|without|excluded|separate|outside|different|kept out|stays private)\b/u;

const BOUNDARY_SEPARATION_PATTERN =
  /\b(?:separate|different|private|public|isolated|boundary)\b/u;

const ALWAYS_PRIVATE_VALUE_PATTERNS = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu,
  /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/u,
  /\b(?:sk-[A-Za-z0-9_-]{16,}|xox[baprs]-[A-Za-z0-9-]{10,}|ghp_[A-Za-z0-9]{20,})\b/u,
  /(?:^|\s)\/(?:users|home|private|var|volumes)\//u,
  /\b(?:file|obsidian):\/\//u,
  /\bhttps?:\/\/(?:localhost|127\.0\.0\.1)\b/u,
] as const;

function containsTerm(normalized: string, term: string): boolean {
  return (` ${normalized} `).includes(` ${term} `);
}

const PROHIBITED_PATTERNS: ReadonlyArray<readonly [
  PublicAnswerGroundingReasonCode,
  readonly RegExp[],
]> = [
  ["prompt_or_policy_leakage", [
    /\b(?:system|developer) (?:prompt|message|instruction)s?\b/u,
    /\bignore (?:all |the )?(?:previous|prior) instructions?\b/u,
    /\b(?:hidden|internal) (?:policy|instruction|prompt)\b/u,
    /\b(?:pretend|act|roleplay) (?:that )?(?:you are|as)\b/u,
    /\b(?:visitor|user|attacker) (?:says|asserts|instructs|requires)\b/u,
    /\bignora (?:todas )?las instrucciones (?:anteriores|previas)\b/u,
    /\bignorez (?:toutes )?les instructions precedentes\b/u,
    /\bignoriere (?:alle )?(?:vorherigen|fruheren) anweisungen\b/u,
  ]],
  ["identity_impersonation", [
    /\bi am (?:carl|his employer|his manager|his recruiter)\b/u,
    /\bspeaking (?:as|for) carl\b/u,
  ]],
  ["unauthorized_action_or_promise", [
    /\b(?:i|carl|we) (?:will|promise|guarantee|accept|agree|commit)\b/u,
    /\b(?:book|schedule|send|email|contact|hire) (?:him|carl|me|us)\b/u,
  ]],
  ["private_or_contact_disclosure", [
    /\b(?:(?:email|phone|home|mailing|street) address|phone number|salary|compensation|availability|relocation)\b/u,
    /\b(?:obsidian|private memory|sqlite|api key|token|password)\b/u,
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu,
    /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/u,
    /\b(?:sk-[A-Za-z0-9_-]{16,}|xox[baprs]-[A-Za-z0-9-]{10,}|ghp_[A-Za-z0-9]{20,})\b/u,
    /(?:^|\s)\/(?:users|home|private|var|volumes)\//u,
    /\b(?:file|obsidian):\/\//u,
    /\bhttps?:\/\/(?:localhost|127\.0\.0\.1)\b/u,
  ]],
  ["prohibited_claim", [
    /\b(?:perfect|guaranteed|best candidate|definitely qualified)\b/u,
  ]],
];
