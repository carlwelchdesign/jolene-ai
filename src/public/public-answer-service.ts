import { z } from "zod";

import { tokenizeLexicalTerms } from "../domain/lexical-terms.js";
import {
  PUBLIC_CAREER_EVIDENCE_SCHEMA_VERSION,
  type PublicCareerEvidenceArtifact,
  type PublicCareerEvidenceRecord,
} from "../domain/public-career-evidence.js";
import {
  PUBLIC_PORTFOLIO_ANSWER_LIMITS,
  portfolioAnswerResponseSchema,
  type PortfolioAnswerRequest,
  type PortfolioAnswerResponse,
} from "../domain/public-portfolio-contract.js";
import type { PublicModelRequestBudget } from "./public-model-request-budget.js";
import {
  PublicAnswerGroundingValidator,
  type PublicAnswerGroundingValidatorLike,
} from "./public-answer-grounding-validator.js";
import {
  containsInternalPublicProcessLanguage,
  visitorFacingClaim,
  visitorFacingLimitations,
} from "./public-visitor-language.js";

export interface PublicPortfolioAnswerer {
  execute(
    artifact: PublicCareerEvidenceArtifact,
    request: PortfolioAnswerRequest,
  ): PublicAnswerExecution | Promise<PublicAnswerExecution>;
}

export interface PublicAnswerExecution {
  readonly response: PortfolioAnswerResponse;
  readonly mode: "deterministic" | "model" | "fallback" | "budget_fallback";
}

export interface GroundedPublicAnswerInput {
  readonly question: string;
  readonly corpusVersion: string;
  readonly evidence: readonly {
    readonly evidenceId: string;
    readonly claimText: string;
    readonly limitations: readonly string[];
    readonly citationTitle: string;
  }[];
}

export interface PublicAnswerTextGenerator {
  generate(input: GroundedPublicAnswerInput): Promise<unknown>;
}

export interface PublicEvidenceRetriever {
  retrieve(
    artifact: PublicCareerEvidenceArtifact,
    request: PortfolioAnswerRequest,
  ): Promise<readonly PublicCareerEvidenceRecord[]>;
}

export class DeterministicPublicAnswerService
  implements PublicPortfolioAnswerer
{
  execute(
    artifact: PublicCareerEvidenceArtifact,
    request: PortfolioAnswerRequest,
  ): PublicAnswerExecution {
    return { response: this.answer(artifact, request), mode: "deterministic" };
  }

  answer(
    artifact: PublicCareerEvidenceArtifact,
    request: PortfolioAnswerRequest,
  ): PortfolioAnswerResponse {
    return this.answerFromSelected(
      artifact,
      request,
      selectDeterministicPublicEvidence(artifact, request),
    );
  }

  answerFromSelected(
    artifact: PublicCareerEvidenceArtifact,
    request: PortfolioAnswerRequest,
    selectedEvidence: readonly PublicCareerEvidenceRecord[],
  ): PortfolioAnswerResponse {
    if (isPrivateDisclosureRequest(request.question)) {
      return privateDisclosureResponse(artifact);
    }
    const hiringValueQuestion = isHiringValueQuestion(request.question);
    const activeEvidence = new Map(
      artifact.evidence.map((record) => [record.evidenceId, record]),
    );
    const selected = uniqueRecords(selectedEvidence
      .map((record) => activeEvidence.get(record.evidenceId))
      .filter((record): record is PublicCareerEvidenceRecord => Boolean(record)))
      .slice(0, PUBLIC_PORTFOLIO_ANSWER_LIMITS.responseItems);
    const conflict = artifact.conflicts.find((candidate) =>
      candidate.evidenceIds.some((evidenceId) =>
        selected.some((record) => record.evidenceId === evidenceId)
      )
    );
    const relationshipFact = exactRecommendationRelationship(
      request.question,
      selected,
    );

    return conflict
      ? conflictResponse(artifact)
      : selected.length === 0
      ? noEvidenceResponse(artifact)
      : supportedResponse(
        artifact,
        selected,
        hiringValueQuestion,
        relationshipFact,
      );
  }
}

const generatedAnswerSchema = z.string().trim().min(1).max(2_000);

export class GroundedPublicAnswerService implements PublicPortfolioAnswerer {
  readonly #baseline: DeterministicPublicAnswerService;
  readonly #budget: PublicModelRequestBudget | undefined;
  readonly #retriever: PublicEvidenceRetriever | undefined;
  readonly #validator: PublicAnswerGroundingValidatorLike;

  constructor(
    private readonly generator: PublicAnswerTextGenerator,
    options: {
      readonly baseline?: DeterministicPublicAnswerService;
      readonly budget?: PublicModelRequestBudget;
      readonly retriever?: PublicEvidenceRetriever;
      readonly validator?: PublicAnswerGroundingValidatorLike;
    } = {},
  ) {
    this.#baseline = options.baseline ?? new DeterministicPublicAnswerService();
    this.#budget = options.budget;
    this.#retriever = options.retriever;
    this.#validator = options.validator ?? new PublicAnswerGroundingValidator();
  }

  async execute(
    artifact: PublicCareerEvidenceArtifact,
    request: PortfolioAnswerRequest,
  ): Promise<PublicAnswerExecution> {
    if (isPrivateDisclosureRequest(request.question)) {
      return {
        response: this.#baseline.answerFromSelected(artifact, request, []),
        mode: "deterministic",
      };
    }
    const exactRelationshipEvidence = selectRecommendationRelationshipEvidence(
      artifact.evidence,
      request.question,
    );
    let baseline = exactRelationshipEvidence.length > 0
      ? this.#baseline.answerFromSelected(
        artifact,
        request,
        exactRelationshipEvidence,
      )
      : this.#baseline.answer(artifact, request);
    if (this.#retriever && exactRelationshipEvidence.length === 0) {
      try {
        baseline = this.#baseline.answerFromSelected(
          artifact,
          request,
          await this.#retriever.retrieve(artifact, request),
        );
      } catch {
        // Retrieval failure preserves the deterministic public-safe baseline.
      }
    }
    if (baseline.claims.length === 0) {
      return { response: baseline, mode: "deterministic" };
    }
    if (exactRelationshipEvidence.length > 0) {
      return { response: baseline, mode: "deterministic" };
    }
    if (this.#budget) {
      try {
        if (!await this.#budget.reserve()) {
          return { response: baseline, mode: "budget_fallback" };
        }
      } catch {
        return { response: baseline, mode: "budget_fallback" };
      }
    }
    try {
      const generation = await this.generator.generate({
        question: request.question,
        corpusVersion: baseline.corpusVersion,
        evidence: baseline.claims.map((claim, index) => ({
          evidenceId: baseline.citations[index]?.evidenceId ?? "missing",
          claimText: claim.text,
          limitations: claim.limitations,
          citationTitle: baseline.citations[index]?.title ?? "Reviewed evidence",
        })),
      });
      const validation = this.#validator.validate(artifact, baseline, generation);
      if (validation.status === "rejected") {
        return { response: baseline, mode: "fallback" };
      }
      const answer = generatedAnswerSchema.parse(validation.answer);
      if (containsInternalPublicProcessLanguage(answer)) {
        return { response: baseline, mode: "fallback" };
      }
      return {
        mode: "model",
        response: portfolioAnswerResponseSchema.parse({
          ...baseline,
          answer,
        }),
      };
    } catch {
      return { response: baseline, mode: "fallback" };
    }
  }
}

export function selectDeterministicPublicEvidence(
  artifact: PublicCareerEvidenceArtifact,
  request: PortfolioAnswerRequest,
): PublicCareerEvidenceRecord[] {
  const relationshipEvidence = selectRecommendationRelationshipEvidence(
    artifact.evidence,
    request.question,
  );
  if (relationshipEvidence.length > 0) return relationshipEvidence;
  if (isHiringValueQuestion(request.question)) {
    return selectHiringValueEvidence(artifact.evidence);
  }
  const queryTerms = tokenizeLexicalTerms(request.question).filter(
    (term) => !PUBLIC_QUERY_STOP_WORDS.has(term),
  );
  return selectLexicalEvidence(artifact.evidence, queryTerms);
}

interface RecommendationRelationshipFact {
  readonly subject: string;
  readonly relationship: string;
  readonly record: PublicCareerEvidenceRecord;
}

function selectRecommendationRelationshipEvidence(
  evidence: readonly PublicCareerEvidenceRecord[],
  question: string,
): PublicCareerEvidenceRecord[] {
  if (!RECOMMENDATION_RELATIONSHIP_QUESTION.test(normalizeLookup(question))) {
    return [];
  }
  const normalizedQuestion = normalizeLookup(question);
  const match = evidence.find((record) => {
    const fact = recommendationRelationshipFact(record);
    return fact !== null && normalizedQuestion.includes(normalizeLookup(fact.subject));
  });
  return match ? [match] : [];
}

function exactRecommendationRelationship(
  question: string,
  evidence: readonly PublicCareerEvidenceRecord[],
): RecommendationRelationshipFact | null {
  const selected = selectRecommendationRelationshipEvidence(evidence, question)[0];
  return selected ? recommendationRelationshipFact(selected) : null;
}

function recommendationRelationshipFact(
  record: PublicCareerEvidenceRecord,
): RecommendationRelationshipFact | null {
  if (!record.citation.title.startsWith("Recommendation from ")) return null;
  const subject = record.citation.title.slice("Recommendation from ".length).trim();
  const limitation = record.claim.limitations.find((candidate) =>
    candidate.startsWith("Contribution boundary: Third-party statement attributed to ")
  );
  const match = limitation?.match(
    /^Contribution boundary: Third-party statement attributed to .+? \((.+?)\);/u,
  );
  if (!subject || !match?.[1]) return null;
  const firstName = subject.split(/\s+/u)[0] ?? subject;
  const relationship = match[1].startsWith(`${firstName} `)
    ? `${subject}${match[1].slice(firstName.length)}`
    : match[1];
  return { subject, relationship, record };
}

function normalizeLookup(value: string): string {
  return value.toLocaleLowerCase("en-US").normalize("NFKC")
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
}

const RECOMMENDATION_RELATIONSHIP_QUESTION =
  /\b(?:relationship|employer|client|boss|supervisor|manager|worked for|worked with)\b/u;

const PUBLIC_QUERY_STOP_WORDS = new Set([
  "carl",
  "evidence",
  "public",
  "review",
  "reviewed",
  "welch",
]);

function score(
  record: PublicCareerEvidenceRecord,
  queryTerms: readonly string[],
): number {
  const candidateTerms = new Set(tokenizeLexicalTerms([
    record.claim.text,
    record.claim.limitations.join(" "),
    record.citation.title,
    record.citation.sourceType,
    record.citation.maturity,
  ].join(" ")));
  return queryTerms.reduce(
    (total, term) => total + (candidateTerms.has(term) ? 1 : 0),
    0,
  );
}

function selectLexicalEvidence(
  evidence: readonly PublicCareerEvidenceRecord[],
  queryTerms: readonly string[],
): PublicCareerEvidenceRecord[] {
  return evidence
    .map((record) => ({ record, score: score(record, queryTerms) }))
    .filter((candidate) => candidate.score > 0)
    .sort(compareScoredEvidence)
    .slice(0, PUBLIC_PORTFOLIO_ANSWER_LIMITS.responseItems)
    .map((candidate) => candidate.record);
}

type HiringEvidenceCategory =
  | "leadership"
  | "professional_role"
  | "capability"
  | "product"
  | "testimonial";

function selectHiringValueEvidence(
  evidence: readonly PublicCareerEvidenceRecord[],
): PublicCareerEvidenceRecord[] {
  const ranked = evidence
    .map((record) => ({ record, score: hiringValueScore(record) }))
    .filter((candidate) => candidate.score > 0)
    .sort(compareScoredEvidence);
  const selected: PublicCareerEvidenceRecord[] = [];
  for (const category of HIRING_CATEGORY_PRIORITY) {
    const candidate = ranked.find(({ record }) =>
      !selected.includes(record) && hiringCategory(record) === category
    );
    if (candidate) selected.push(candidate.record);
  }
  for (const candidate of ranked) {
    if (selected.length >= PUBLIC_PORTFOLIO_ANSWER_LIMITS.responseItems) break;
    if (!selected.includes(candidate.record)) selected.push(candidate.record);
  }
  return selected.slice(0, PUBLIC_PORTFOLIO_ANSWER_LIMITS.responseItems);
}

function compareScoredEvidence(
  left: { readonly record: PublicCareerEvidenceRecord; readonly score: number },
  right: { readonly record: PublicCareerEvidenceRecord; readonly score: number },
): number {
  return right.score - left.score ||
    left.record.evidenceId.localeCompare(right.record.evidenceId);
}

const HIRING_CATEGORY_PRIORITY: readonly HiringEvidenceCategory[] = [
  "leadership",
  "professional_role",
  "capability",
  "product",
  "testimonial",
];

function hiringCategory(
  record: PublicCareerEvidenceRecord,
): HiringEvidenceCategory {
  const title = record.citation.title.toLocaleLowerCase("en-US");
  const text = `${title} ${record.claim.text}`.toLocaleLowerCase("en-US");
  if (title === "technical leadership" || /\b(?:leading|leadership|managed)\b/u.test(text)) {
    return "leadership";
  }
  if (/\b(?:senior|lead|manager)\b.+\bat\b/u.test(title)) {
    return "professional_role";
  }
  if (title.startsWith("recommendation from ")) return "testimonial";
  if (record.citation.maturity === "production" ||
    record.citation.maturity === "deployed_demo" ||
    record.citation.maturity === "pre_release") {
    return "product";
  }
  return "capability";
}

function hiringValueScore(record: PublicCareerEvidenceRecord): number {
  const title = record.citation.title.toLocaleLowerCase("en-US");
  const text = `${title} ${record.claim.text}`.toLocaleLowerCase("en-US");
  let value = HIRING_VALUE_TERMS.reduce(
    (total, term) => total + (text.includes(term) ? 2 : 0),
    0,
  );
  if (title === "technical leadership") value += 24;
  if (/\b(?:senior|lead|manager)\b.+\bat\b/u.test(title)) value += 16;
  if (title === "bounded ai workflows" || title === "product interface systems") {
    value += 18;
  }
  if (title.startsWith("recommendation from ")) value += 8;
  if (record.citation.maturity === "production") value += 7;
  if (record.citation.maturity === "deployed_demo") value += 4;
  if (HIRING_BOUNDARY_ONLY_PATTERNS.some((pattern) => pattern.test(text))) {
    value -= 24;
  }
  return value;
}

const HIRING_VALUE_TERMS = [
  "built",
  "delivered",
  "design",
  "developed",
  "engineer",
  "frontend",
  "high-performance",
  "interface",
  "led",
  "managed",
  "mentor",
  "product",
  "react",
  "security",
  "system",
  "team",
  "typescript",
] as const;

const HIRING_BOUNDARY_ONLY_PATTERNS = [
  /\bnot (?:a|intended|represented)\b/u,
  /\bdo not replace\b/u,
  /\bremaining .+ checks\b/u,
  /\bpre-release tester builds\b/u,
] as const;

function isHiringValueQuestion(question: string): boolean {
  const normalized = question.toLocaleLowerCase("en-US").normalize("NFKC");
  if (HIRING_VALUE_UNSAFE_PATTERN.test(normalized)) return false;
  return HIRING_VALUE_PATTERNS.some((pattern) => pattern.test(normalized));
}

const HIRING_VALUE_PATTERNS = [
  /\bwhy\s+(?:should|would)\s+(?:i|we|someone|a company)\s+hire\b/u,
  /\bwhy\s+(?:should(?:n['’]t|\s+not)|would(?:n['’]t|\s+not))\s+(?:i|we|someone|a company)\s+hire\b/u,
  /\bwhy\s+(?:should|would)\s+(?:i|we|someone|a company)\s+not\s+hire\b/u,
  /\bwhy\s+hire\b/u,
  /\bwhat\s+makes\s+carl\s+(?:a\s+)?(?:strong|good|qualified|valuable)\s+(?:candidate|hire)\b/u,
  /\b(?:reasons?|case)\s+(?:to|for)\s+hire\b/u,
  /\b(?:strengths|value)\b.+\b(?:candidate|hire|team)\b/u,
] as const;

const HIRING_VALUE_UNSAFE_PATTERN =
  /\b(?:bypass|contact|ignore|private|reveal|secret|system prompt)\b/u;

function isPrivateDisclosureRequest(question: string): boolean {
  const normalized = question.normalize("NFKC");
  const requestsPrivateMaterial = /\b(?:private|unpublished)\b.{0,48}\b(?:memory|notes?|files?|data|details?|material|work|information)\b/iu.test(normalized)
    || /\b(?:reveal|share|show|tell|expose|leak)\b.{0,64}\b(?:private|secret|unpublished)\b/iu.test(normalized)
    || /\b(?:system prompt|api key|password|home address|phone number|email address|medical record|salary|compensation)\b/iu.test(normalized);
  const includesPublicCareerQuestion = /\b(?:describe|explain|summarize|what|which|how)\b.{0,96}\b(?:react|projects?|systems?|portfolio|experience|roles?|skills?|recommendations?|career|aviation|leadership)\b/iu
    .test(normalized);
  return requestsPrivateMaterial && !includesPublicCareerQuestion;
}

function supportedResponse(
  artifact: PublicCareerEvidenceArtifact,
  selected: readonly PublicCareerEvidenceRecord[],
  hiringValueQuestion = false,
  relationshipFact: RecommendationRelationshipFact | null = null,
): PortfolioAnswerResponse {
  return portfolioAnswerResponseSchema.parse({
    schemaVersion: PUBLIC_CAREER_EVIDENCE_SCHEMA_VERSION,
    answer: relationshipFact
      ? boundedRelationshipAnswer(relationshipFact)
      : hiringValueQuestion
      ? boundedHiringValueAnswer(selected)
      : boundedSupportedAnswer(selected),
    claims: selected.map((record) => visitorFacingClaim(record.claim)),
    citations: selected.map((record) => record.citation),
    limitations: unique(hiringValueQuestion
      ? ["A hiring decision should still be based on the role, interviews, and direct references."]
      : visitorFacingLimitations(selected.flatMap((record) => record.claim.limitations)))
      .slice(0, PUBLIC_PORTFOLIO_ANSWER_LIMITS.responseLimitations),
    suggestedFollowUpQuestions: relationshipFact
      ? [
        `Would you like to read ${relationshipFact.subject}’s full recommendation?`,
        "Would you like to ask about another professional relationship?",
      ]
      : hiringValueQuestion
      ? [
        "Would you like to compare Carl's evidence with a specific job description?",
        "Which leadership, product, or technical example should we examine more closely?",
      ]
      : [
        "Which cited project or role would you like to examine more closely?",
        "What limitations should we clarify with Carl directly?",
      ],
    corpusVersion: artifact.manifest.corpusVersion,
  });
}

function boundedRelationshipAnswer(fact: RecommendationRelationshipFact): string {
  const relationship = `${fact.relationship.replace(/[.!?]+$/u, "")}.`;
  const prefix = `${relationship} The supporting recommendation says: “`;
  const suffix = "”";
  const available = PUBLIC_PORTFOLIO_ANSWER_LIMITS.answerCharacters -
    prefix.length - suffix.length;
  return `${prefix}${fact.record.claim.text.slice(0, available).trimEnd()}${suffix}`;
}

function noEvidenceResponse(
  artifact: PublicCareerEvidenceArtifact,
): PortfolioAnswerResponse {
  return portfolioAnswerResponseSchema.parse({
    schemaVersion: PUBLIC_CAREER_EVIDENCE_SCHEMA_VERSION,
    answer:
      "I don’t have enough published information to answer that reliably.",
    claims: [],
    citations: [],
    limitations: ["No relevant published information was found for this question."],
    suggestedFollowUpQuestions: [
      "Would you like to ask about a published project, professional role, skill, or contribution?",
    ],
    corpusVersion: artifact.manifest.corpusVersion,
  });
}

function privateDisclosureResponse(
  artifact: PublicCareerEvidenceArtifact,
): PortfolioAnswerResponse {
  return portfolioAnswerResponseSchema.parse({
    schemaVersion: PUBLIC_CAREER_EVIDENCE_SCHEMA_VERSION,
    answer: "I can’t share Carl’s private notes or unpublished material. Ask me about his published work, professional experience, or public recommendations instead.",
    claims: [],
    citations: [],
    limitations: [
      "Private and unpublished material is outside this public assistant’s scope.",
    ],
    suggestedFollowUpQuestions: [
      "Which published project or professional role would you like to explore?",
    ],
    corpusVersion: artifact.manifest.corpusVersion,
  });
}

function conflictResponse(
  artifact: PublicCareerEvidenceArtifact,
): PortfolioAnswerResponse {
  return portfolioAnswerResponseSchema.parse({
    schemaVersion: PUBLIC_CAREER_EVIDENCE_SCHEMA_VERSION,
    answer:
      "The published information available to me conflicts on this point, so I can’t answer it reliably.",
    claims: [],
    citations: [],
    limitations: [
      "The conflicting accounts need clarification before I can use them here.",
    ],
    suggestedFollowUpQuestions: [
      "Would you like to ask about a different published project, role, skill, or contribution?",
    ],
    corpusVersion: artifact.manifest.corpusVersion,
  });
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function uniqueRecords(
  values: readonly PublicCareerEvidenceRecord[],
): PublicCareerEvidenceRecord[] {
  const seen = new Set<string>();
  return values.filter((record) => {
    if (seen.has(record.evidenceId)) return false;
    seen.add(record.evidenceId);
    return true;
  });
}

function boundedSupportedAnswer(
  selected: readonly PublicCareerEvidenceRecord[],
): string {
  const prefix = "Here’s what Carl’s published work shows: ";
  const available = PUBLIC_PORTFOLIO_ANSWER_LIMITS.answerCharacters -
    prefix.length;
  return `${prefix}${selected
    .map((record) => record.claim.text)
    .join(" ")
    .slice(0, available)
    .trimEnd()}`;
}

function boundedHiringValueAnswer(
  selected: readonly PublicCareerEvidenceRecord[],
): string {
  const categories = new Set(selected.map(hiringCategory));
  const strengths = HIRING_CATEGORY_PRIORITY
    .filter((category) => categories.has(category))
    .map((category) => HIRING_CATEGORY_SUMMARIES[category]);
  return `Carl may be worth considering for roles that value ${formatNaturalList(strengths)}. The examples below show what he has actually done and where the evidence has limits.`;
}

const HIRING_CATEGORY_SUMMARIES: Readonly<Record<
  HiringEvidenceCategory,
  string
>> = {
  leadership: "technical leadership and mentoring",
  professional_role: "senior professional delivery",
  capability: "connecting product design with implementation",
  product: "hands-on product-system work",
  testimonial: "the trust of people who have worked with him",
};

function formatNaturalList(values: readonly string[]): string {
  if (values.length === 0) return "evidence-backed product engineering";
  if (values.length === 1) return values[0] ?? "evidence-backed product engineering";
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}
