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
    const segments = parsed.data.segments.flatMap((segment) =>
      materialSentences(segment.text).map((text) => ({ ...segment, text }))
    );
    if (
      segments.length === 0 ||
      segments.length > PUBLIC_ANSWER_GROUNDING_LIMITS.normalizedSegments
    ) {
      return rejected("output_schema_invalid", null, startedAt);
    }

    const selectedIds = new Set(baseline.citations.map((item) => item.evidenceId));
    const active = new Map(artifact.evidence.map((item) => [item.evidenceId, item]));
    const revoked = new Set(artifact.manifest.revokedEvidenceIds);
    const conflicted = new Set(artifact.conflicts.flatMap((item) => item.evidenceIds));

    let acceptedPresentation = parsed.data.presentation;
    if (acceptedPresentation) {
      const presentationFailure = validatePresentation(acceptedPresentation);
      if (presentationFailure === "unsupported_segment") {
        acceptedPresentation = null;
      } else if (presentationFailure) {
        return rejected(presentationFailure, null, startedAt);
      }
    }

    const acceptedSegments: typeof segments = [];
    let firstUnsupportedIndex: number | null = null;
    for (const [index, segment] of segments.entries()) {
      if (elapsed(startedAt) > PUBLIC_ANSWER_GROUNDING_LIMITS.validationMilliseconds) {
        return rejected("validation_timeout", index, startedAt);
      }
      const sentenceCount = materialSentenceCount(segment.text);
      if (sentenceCount !== 1) {
        logGroundingDiagnostic("sentence_count", index, {
          sentenceCount,
        });
        firstUnsupportedIndex ??= index;
        continue;
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
      const entailmentFailure = validateEntailment(segment.text, records, index);
      if (entailmentFailure === "unsupported_segment") {
        firstUnsupportedIndex ??= index;
        continue;
      }
      if (entailmentFailure) return rejected(entailmentFailure, index, startedAt);
      acceptedSegments.push(segment);
    }
    if (acceptedSegments.length === 0) {
      return rejected("unsupported_segment", firstUnsupportedIndex, startedAt);
    }

    const coveredEvidenceIds = new Set(
      acceptedSegments.flatMap((segment) => segment.supportIds),
    );
    const sourceCompletions = baseline.citations
      .filter((citation) => !coveredEvidenceIds.has(citation.evidenceId))
      .map((citation) => active.get(citation.evidenceId)!.claim.text);

    const answer = [
      acceptedPresentation,
      ...groupContiguousGroundedSegments(acceptedSegments),
      ...sourceCompletions,
    ].filter((value): value is string => Boolean(value)).join("\n\n");
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
        segmentCount: acceptedSegments.length,
        supportCount: acceptedSegments.reduce(
          (total, segment) => total + segment.supportIds.length,
          0,
        ),
        elapsedMilliseconds: duration,
      },
    };
  }
}

function groupContiguousGroundedSegments(
  segments: readonly {
    readonly text: string;
    readonly supportIds: readonly string[];
  }[],
): string[] {
  const paragraphs: { text: string; supportKey: string }[] = [];
  for (const segment of segments) {
    const supportKey = segment.supportIds.join("\u0000");
    const previous = paragraphs.at(-1);
    if (previous?.supportKey === supportKey) {
      previous.text = `${previous.text} ${segment.text}`;
    } else {
      paragraphs.push({ text: segment.text, supportKey });
    }
  }
  return paragraphs.map((paragraph) => paragraph.text);
}

function validatePresentation(
  text: string,
): PublicAnswerGroundingReasonCode | null {
  if (materialSentenceCount(text) !== 1) return "unsupported_segment";
  const words = text.match(/[\p{L}\p{N}’'-]+/gu) ?? [];
  if (words.length < 2 || words.length > 16) return "unsupported_segment";
  const prohibited = prohibitedReason(text, []);
  if (prohibited) return prohibited;
  const normalized = normalize(text);
  if (
    /\d/u.test(text) ||
    PRESENTATION_FACT_PATTERN.test(normalized) ||
    PRESENTATION_NAMED_TERM_PATTERN.test(normalized)
  ) return "unsupported_segment";
  return null;
}

function validateEntailment(
  text: string,
  records: readonly PublicCareerEvidenceRecord[],
  segmentIndex: number,
): PublicAnswerGroundingReasonCode | null {
  const terms = materialTerms(text);
  if (terms.length < 2) return "unsupported_segment";
  const numbers = text.match(/\b\d+(?:[.,]\d+)?%?\b/gu) ?? [];
  const normalizedText = normalize(text);
  const hasNegation = /\b(?:no|not|never|without)\b/u.test(normalizedText);

  let supported = false;
  let bestCoverage = 0;
  for (const record of records) {
    const sourceText = [
      record.claim.text,
      ...record.claim.limitations,
      record.citation.title,
    ].join(" ");
    const sourceTerms = new Set(materialTerms(sourceText));
    const overlap = terms.filter((term) => sourceTerms.has(term)).length;
    const coverage = overlap / terms.length;
    bestCoverage = Math.max(bestCoverage, coverage);
    const sourceNormalized = normalize(sourceText);
    const boundaryMatches = CONTRIBUTION_BOUNDARY_TERMS.every((term) =>
      !containsTerm(normalizedText, term) ||
      sourceContainsContributionTerm(sourceNormalized, term)
    );
    if (!boundaryMatches) continue;
    const numbersMatch = numbers.every((number) => sourceNormalized.includes(number));
    const negationMatches = !hasNegation ||
      /\b(?:no|not|never|without)\b/u.test(sourceNormalized) ||
      (
        BOUNDARY_SEPARATION_PATTERN.test(normalizedText) &&
        BOUNDARY_SEPARATION_PATTERN.test(sourceNormalized)
      );
    if (overlap >= 2 && coverage >= 0.3 && numbersMatch && negationMatches) {
      supported = true;
    }
  }
  if (!supported && CONTRIBUTION_BOUNDARY_TERMS.some((term) =>
    containsTerm(normalizedText, term) && !records.some((record) =>
      sourceContainsContributionTerm(normalize([
        record.claim.text,
        ...record.claim.limitations,
        record.citation.title,
      ].join(" ")), term)
    )
  )) return "contribution_boundary_violation";
  if (!supported) {
    logGroundingDiagnostic("lexical_coverage", segmentIndex, {
      materialTermCount: terms.length,
      bestCoverageBps: Math.floor(bestCoverage * 10_000),
    });
    return "unsupported_segment";
  }

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

function logGroundingDiagnostic(
  diagnostic: "lexical_coverage" | "sentence_count",
  segmentIndex: number,
  counts: Readonly<Record<string, number>>,
): void {
  if (!process.env.VERCEL_ENV) return;
  console.info(JSON.stringify({
    event: "public_answer_grounding_diagnostic",
    diagnostic,
    segmentIndex,
    ...counts,
  }));
}

function sourceContainsContributionTerm(source: string, term: string): boolean {
  return containsTerm(source, term) ||
    (term === "led" && /\b(?:lead|leading|leadership)\b/u.test(source));
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
  return materialSentences(value).length;
}

function materialSentences(value: string): string[] {
  const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
  return [...segmenter.segment(value)]
    .map((item) => item.segment.trim())
    .filter((sentence) => /[\p{L}\p{N}]/u.test(sentence));
}

const GROUNDING_STOP_WORDS = new Set([
  "a", "about", "also", "an", "and", "are", "as", "at", "be", "because",
  "been", "but", "by", "carl", "does", "evidence", "for", "from", "has",
  "have", "he", "his", "in", "into", "is", "it", "its", "of", "on", "or",
  "reviewed", "that", "the", "their", "this", "to", "was", "were", "which",
  "with", "work",
]);

const PRESENTATION_FACT_PATTERN =
  /\b(?:i|you|he|she|it|we|they|this|that|these|those|him|her|them|his|hers|their|built|created|designed|directed|worked|led|managed|uses|used|knows|qualified|experienced|available|hire|employ|client|award|won|can|will|should|must|guarantee|is|was|has|did)\b/u;

const PRESENTATION_NAMED_TERM_PATTERN =
  /\b(?:carl|jolene|openai|chatgpt|slack|obsidian|sqlite|vercel|react|typescript|javascript|docker|mcp|rag)\b/u;

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
