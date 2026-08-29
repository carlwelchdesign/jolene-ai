import { z } from "zod";

import { tokenizeLexicalTerms } from "../domain/lexical-terms.js";
import {
  PUBLIC_CAREER_EVIDENCE_SCHEMA_VERSION,
  type PublicCareerEvidenceArtifact,
  type PublicCareerEvidenceRecord,
} from "../domain/public-career-evidence.js";
import {
  PUBLIC_CONVERSATION_CONTEXT_LIMITS,
  PUBLIC_PORTFOLIO_ANSWER_LIMITS,
  portfolioAnswerResponseSchema,
  type PortfolioAnswerRequest,
  type PortfolioAnswerResponse,
  type PublicConversationContext,
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
  readonly mode:
    | "deterministic"
    | "model"
    | "budget_fallback"
    | "provider_fallback"
    | "validation_fallback";
  readonly responseKind:
    | "supported"
    | "clarification"
    | "no_evidence"
    | "policy_refusal";
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
    const response = this.answer(artifact, request);
    return {
      response,
      mode: "deterministic",
      responseKind: deterministicResponseKind(request, response),
    };
  }

  answer(
    artifact: PublicCareerEvidenceArtifact,
    request: PortfolioAnswerRequest,
  ): PortfolioAnswerResponse {
    const turn = resolvePublicConversationTurn(artifact, request);
    return this.answerFromSelected(
      artifact,
      turn.request,
      selectDeterministicPublicEvidence(artifact, turn.request),
      turn.responseContext,
    );
  }

  answerFromSelected(
    artifact: PublicCareerEvidenceArtifact,
    request: PortfolioAnswerRequest,
    selectedEvidence: readonly PublicCareerEvidenceRecord[],
    conversationContext?: PublicConversationContext,
  ): PortfolioAnswerResponse {
    if (isPrivateDisclosureRequest(request.question)) {
      return privateDisclosureResponse(artifact);
    }
    const hiringValueQuestion = isHiringValueQuestion(request.question);
    const negativeHiringQuestion = isNegativeHiringQuestion(request.question);
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

    const response = conflict
      ? conflictResponse(artifact)
      : selected.length === 0
      ? noEvidenceResponse(artifact)
      : supportedResponse(
        artifact,
        selected,
        hiringValueQuestion,
        negativeHiringQuestion,
        relationshipFact,
      );
    return withConversationContext(response, conversationContext);
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
    const turn = resolvePublicConversationTurn(artifact, request);
    const selectionRequest = turn.request;
    if (isPrivateDisclosureRequest(request.question)) {
      return {
        response: this.#baseline.answerFromSelected(
          artifact,
          request,
          [],
          undefined,
        ),
        mode: "deterministic",
        responseKind: "policy_refusal",
      };
    }
    const exactRelationshipEvidence = selectRecommendationRelationshipEvidence(
      artifact.evidence,
      selectionRequest.question,
    );
    let baseline = exactRelationshipEvidence.length > 0
      ? this.#baseline.answerFromSelected(
        artifact,
        selectionRequest,
        exactRelationshipEvidence,
        turn.responseContext,
      )
      : this.#baseline.answerFromSelected(
        artifact,
        selectionRequest,
        selectDeterministicPublicEvidence(artifact, selectionRequest),
        turn.responseContext,
      );
    if (this.#retriever && exactRelationshipEvidence.length === 0) {
      try {
        baseline = this.#baseline.answerFromSelected(
          artifact,
          selectionRequest,
          await this.#retriever.retrieve(artifact, selectionRequest),
          turn.responseContext,
        );
      } catch {
        // Retrieval failure preserves the deterministic public-safe baseline.
      }
    }
    if (baseline.claims.length === 0) {
      return {
        response: baseline,
        mode: "deterministic",
        responseKind: "no_evidence",
      };
    }
    if (exactRelationshipEvidence.length > 0) {
      return {
        response: baseline,
        mode: "deterministic",
        responseKind: "supported",
      };
    }
    if (this.#budget) {
      try {
        if (!await this.#budget.reserve()) {
          return fallbackExecution(baseline, "budget_fallback");
        }
      } catch {
        return fallbackExecution(baseline, "budget_fallback");
      }
    }
    let generation: unknown;
    try {
      generation = await this.generator.generate({
        question: request.question,
        corpusVersion: baseline.corpusVersion,
        evidence: baseline.claims.map((claim, index) => ({
          evidenceId: baseline.citations[index]?.evidenceId ?? "missing",
          claimText: claim.text,
          limitations: claim.limitations,
          citationTitle: baseline.citations[index]?.title ?? "Reviewed evidence",
        })),
      });
    } catch {
      return fallbackExecution(baseline, "provider_fallback");
    }
    try {
      const validation = this.#validator.validate(artifact, baseline, generation);
      if (validation.status === "rejected") {
        return fallbackExecution(baseline, "validation_fallback");
      }
      const answer = generatedAnswerSchema.parse(validation.answer);
      if (containsInternalPublicProcessLanguage(answer)) {
        return fallbackExecution(baseline, "validation_fallback");
      }
      return {
        mode: "model",
        responseKind: "supported",
        response: portfolioAnswerResponseSchema.parse({
          ...baseline,
          answer,
        }),
      };
    } catch {
      return fallbackExecution(baseline, "validation_fallback");
    }
  }
}

type PublicAnswerFallbackMode = Extract<
  PublicAnswerExecution["mode"],
  "budget_fallback" | "provider_fallback" | "validation_fallback"
>;

function fallbackExecution(
  baseline: PortfolioAnswerResponse,
  mode: PublicAnswerFallbackMode,
): PublicAnswerExecution {
  if (!isRawClaimConcatenation(baseline.answer)) {
    return { response: baseline, mode, responseKind: "supported" };
  }
  return {
    mode,
    responseKind: "clarification",
    response: clarificationResponse(baseline),
  };
}

function clarificationResponse(
  baseline: PortfolioAnswerResponse,
): PortfolioAnswerResponse {
  return portfolioAnswerResponseSchema.parse({
    ...baseline,
    answer:
      "I hit a snag turning those sources into a clean answer, and I’d rather ask a sharper question than hand you word salad. Try one specific project, role, skill, or recommendation.",
    claims: [],
    citations: [],
    limitations: [
      "A reliable grounded answer was not available for this request.",
    ],
    suggestedFollowUpQuestions: [
      "Which published project or professional role would you like to explore?",
    ],
  });
}

function deterministicResponseKind(
  request: PortfolioAnswerRequest,
  response: PortfolioAnswerResponse,
): PublicAnswerExecution["responseKind"] {
  if (isPrivateDisclosureRequest(request.question)) return "policy_refusal";
  return response.claims.length === 0 ? "no_evidence" : "supported";
}

function isRawClaimConcatenation(answer: string): boolean {
  return answer.startsWith(RAW_CLAIM_CONCATENATION_PREFIX);
}

export interface ResolvedPublicConversationTurn {
  readonly request: PortfolioAnswerRequest;
  readonly responseContext?: PublicConversationContext;
  readonly usedPriorContext: boolean;
}

export function resolvePublicConversationTurn(
  artifact: PublicCareerEvidenceArtifact,
  request: PortfolioAnswerRequest,
  now = new Date(),
): ResolvedPublicConversationTurn {
  const explicitProjectPath = matchPublicProjectEntityPath(
    artifact.evidence,
    request.question,
  );
  const prior = validPriorConversationContext(artifact, request, now);
  const canUsePrior = Boolean(
    prior &&
    !explicitProjectPath &&
    isContextualFollowUp(request.question) &&
    !isPrivateDisclosureRequest(request.question) &&
    !PROMPT_INJECTION_CARRYOVER_PATTERN.test(normalizeLookup(request.question)) &&
    !RECOMMENDATION_RELATIONSHIP_QUESTION.test(normalizeLookup(request.question)) &&
    !isHiringValueQuestion(request.question),
  );
  const projectPath = explicitProjectPath ?? (canUsePrior ? prior?.projectPath : null);
  if (!projectPath) return { request, usedPriorContext: false };

  const turnCount = prior?.projectPath === projectPath
    ? Math.min(prior.turnCount + 1, PUBLIC_CONVERSATION_CONTEXT_LIMITS.turns)
    : 1;
  const responseContext = {
    corpusVersion: artifact.manifest.corpusVersion,
    projectPath,
    turnCount,
    expiresAt: new Date(
      now.getTime() + PUBLIC_CONVERSATION_CONTEXT_LIMITS.lifetimeSeconds * 1_000,
    ).toISOString(),
  } satisfies PublicConversationContext;
  if (!canUsePrior) {
    return { request, responseContext, usedPriorContext: false };
  }
  return {
    request: {
      ...request,
      question: `${request.question}\nContextual project: ${projectPath
        .slice("/work/".length)
        .replaceAll("-", " ")}.`,
    },
    responseContext,
    usedPriorContext: true,
  };
}

function validPriorConversationContext(
  artifact: PublicCareerEvidenceArtifact,
  request: PortfolioAnswerRequest,
  now: Date,
): PublicConversationContext | null {
  const context = request.conversationContext;
  if (
    !context ||
    context.corpusVersion !== artifact.manifest.corpusVersion ||
    context.turnCount >= PUBLIC_CONVERSATION_CONTEXT_LIMITS.turns ||
    Date.parse(context.expiresAt) <= now.getTime() ||
    Date.parse(context.expiresAt) >
      now.getTime() + PUBLIC_CONVERSATION_CONTEXT_LIMITS.lifetimeSeconds * 1_000
  ) return null;
  return artifact.evidence.some((record) =>
      record.citation.href === context.projectPath ||
      record.citation.href.startsWith(`${context.projectPath}#`)
    )
    ? context
    : null;
}

function isContextualFollowUp(question: string): boolean {
  return CONTEXTUAL_FOLLOW_UP_PATTERN.test(normalizeLookup(question));
}

function withConversationContext(
  response: PortfolioAnswerResponse,
  conversationContext: PublicConversationContext | undefined,
): PortfolioAnswerResponse {
  return conversationContext
    ? portfolioAnswerResponseSchema.parse({ ...response, conversationContext })
    : response;
}

const CONTEXTUAL_FOLLOW_UP_PATTERN =
  /^(?:and\b|also\b|but\b|how\b|tell me more\b|what about\b|what else\b|why\b|which\b|who\b)|\b(?:it|that|this|those|them|there|the project)\b/u;

const PROMPT_INJECTION_CARRYOVER_PATTERN =
  /\b(?:ignore|override|reveal|system prompt|developer message|hidden instructions|previous instructions)\b/u;

export function selectDeterministicPublicEvidence(
  artifact: PublicCareerEvidenceArtifact,
  request: PortfolioAnswerRequest,
): PublicCareerEvidenceRecord[] {
  const projectEvidence = selectProjectEntityEvidence(
    artifact.evidence,
    request.question,
  );
  if (projectEvidence.length > 0) return projectEvidence;
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

function selectProjectEntityEvidence(
  evidence: readonly PublicCareerEvidenceRecord[],
  question: string,
): PublicCareerEvidenceRecord[] {
  const projectPath = matchPublicProjectEntityPath(evidence, question);
  if (!projectPath) return [];
  const projectEvidence = evidence.filter((record) =>
    record.citation.href === projectPath ||
    record.citation.href.startsWith(`${projectPath}#`)
  );
  const normalizedQuestion = normalizeLookup(question);
  const queryTerms = tokenizeLexicalTerms(question).filter(
    (term) => !PUBLIC_QUERY_STOP_WORDS.has(term),
  );
  const howBuilt = /\b(?:how|build|built|designed|architecture|work|works)\b/u
    .test(normalizedQuestion);
  return projectEvidence
    .map((record) => ({
      record,
      score: score(record, queryTerms) + projectOverviewScore(record) +
        (howBuilt ? howBuiltScore(record) : 0),
    }))
    .sort(compareScoredEvidence)
    .slice(0, PUBLIC_PORTFOLIO_ANSWER_LIMITS.responseItems)
    .map(({ record }) => record);
}

export function matchPublicProjectEntityPath(
  evidence: readonly PublicCareerEvidenceRecord[],
  question: string,
): string | null {
  const normalizedQuestion = normalizeLookup(question);
  const slugs = [...new Set(evidence.flatMap((record) => {
    const slug = record.citation.href.match(/^\/work\/([a-z0-9-]+)(?:#|$)/u)?.[1];
    return slug ? [slug] : [];
  }))];
  const matchedSlug = slugs
    .map((slug) => ({ slug, aliases: projectAliases(slug) }))
    .filter(({ aliases }) => aliases.some((alias) =>
      (` ${normalizedQuestion} `).includes(` ${alias} `)
    ))
    .sort((left, right) =>
      Math.max(...right.aliases.map((alias) => alias.length)) -
        Math.max(...left.aliases.map((alias) => alias.length)) ||
      left.slug.localeCompare(right.slug)
    )[0]?.slug;
  return matchedSlug ? `/work/${matchedSlug}` : null;
}

function projectAliases(slug: string): string[] {
  const tokens = slug.split("-");
  const descriptive = tokens.filter((token) => token !== "ai" && token !== "os");
  return [...new Set([
    tokens.join(" "),
    descriptive.join(" "),
  ].filter((alias) => alias.length >= 3))];
}

function projectOverviewScore(record: PublicCareerEvidenceRecord): number {
  const text = normalizeLookup(`${record.citation.title} ${record.claim.text}`);
  return PROJECT_OVERVIEW_TERMS.reduce(
    (total, [term, weight]) => total + (text.includes(term) ? weight : 0),
    0,
  );
}

function howBuiltScore(record: PublicCareerEvidenceRecord): number {
  const text = normalizeLookup(`${record.citation.title} ${record.claim.text}`);
  return HOW_BUILT_TERMS.reduce(
    (total, [term, weight]) => total + (text.includes(term) ? weight : 0),
    0,
  );
}

const PROJECT_OVERVIEW_TERMS = [
  ["designed", 10],
  ["originated", 10],
  ["architecture", 9],
  ["openai", 8],
  ["retrieval", 7],
  ["personality", 6],
] as const;

const HOW_BUILT_TERMS = [
  ["originated", 16],
  ["directed", 14],
  ["designed", 12],
  ["architecture", 12],
  ["openai", 10],
  ["synthesis", 9],
  ["retrieval", 9],
  ["hybrid", 8],
  ["docker", 7],
  ["runtime", 6],
  ["backend for frontend", 5],
] as const;

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
  /\bwhy\s+(?:should(?:n['’]?t|\s+not)|would(?:n['’]?t|\s+not))\s+(?:i|we|someone|a company)\s+hire\b/u,
  /\bwhy\s+(?:should|would)\s+(?:i|we|someone|a company)\s+not\s+hire\b/u,
  /\bwhy\s+hire\b/u,
  /\bwhat\s+makes\s+carl\s+(?:a\s+)?(?:strong|good|qualified|valuable)\s+(?:candidate|hire)\b/u,
  /\b(?:reasons?|case)\s+(?:to|for)\s+hire\b/u,
  /\b(?:strengths|value)\b.+\b(?:candidate|hire|team)\b/u,
] as const;

function isNegativeHiringQuestion(question: string): boolean {
  const normalized = question.toLocaleLowerCase("en-US").normalize("NFKC");
  return /\b(?:should(?:n['’]?t|\s+not)|would(?:n['’]?t|\s+not)|not\s+hire)\b/u
    .test(normalized);
}

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
  negativeHiringQuestion = false,
  relationshipFact: RecommendationRelationshipFact | null = null,
): PortfolioAnswerResponse {
  return portfolioAnswerResponseSchema.parse({
    schemaVersion: PUBLIC_CAREER_EVIDENCE_SCHEMA_VERSION,
    answer: relationshipFact
      ? boundedRelationshipAnswer(relationshipFact)
      : hiringValueQuestion
      ? boundedHiringValueAnswer(selected, negativeHiringQuestion)
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
      "I don’t have enough published information to answer that honestly—and I’d rather leave a blank than decorate a guess.",
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
    answer: "That door stays locked: I can’t share Carl’s private notes or unpublished material. I can still help with his published work, professional experience, or public recommendations.",
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
      "Those sources conflict and pull in different directions, so I’m not going to dress up a guess as an answer.",
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
  const available = PUBLIC_PORTFOLIO_ANSWER_LIMITS.answerCharacters -
    RAW_CLAIM_CONCATENATION_PREFIX.length;
  return `${RAW_CLAIM_CONCATENATION_PREFIX}${selected
    .map((record) => record.claim.text)
    .join(" ")
    .slice(0, available)
    .trimEnd()}`;
}

const RAW_CLAIM_CONCATENATION_PREFIX =
  "Here’s what Carl’s published work shows: ";

function boundedHiringValueAnswer(
  selected: readonly PublicCareerEvidenceRecord[],
  negativeQuestion = false,
): string {
  const categories = new Set(selected.map(hiringCategory));
  const strengths = HIRING_CATEGORY_PRIORITY
    .filter((category) => categories.has(category))
    .map((category) => HIRING_CATEGORY_SUMMARIES[category]);
  if (negativeQuestion) {
    return `Don’t hire Carl because a portfolio assistant told you to. The material here is strongest on ${formatNaturalList(strengths)}; if the role centers somewhere else, compare the job description and test that gap directly in an interview. That is more useful than putting a bow on an unknown.`;
  }
  return `Short answer: Carl is useful where product design and engineering need to stop waving across the hallway and build the same thing. The material below points to ${formatNaturalList(strengths)}. That is a strong shape for the right role, not a magic fit for every role; a job description will show whether it fits yours.`;
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
