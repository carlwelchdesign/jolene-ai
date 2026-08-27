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
  readonly evidence: readonly {
    readonly claimText: string;
    readonly limitations: readonly string[];
    readonly citationTitle: string;
  }[];
}

export interface PublicAnswerTextGenerator {
  generate(input: GroundedPublicAnswerInput): Promise<string>;
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

    return conflict
      ? conflictResponse(artifact)
      : selected.length === 0
      ? noEvidenceResponse(artifact)
      : supportedResponse(artifact, selected, hiringValueQuestion);
  }
}

const generatedAnswerSchema = z.string().trim().min(1).max(2_000);

export class GroundedPublicAnswerService implements PublicPortfolioAnswerer {
  readonly #baseline: DeterministicPublicAnswerService;
  readonly #budget: PublicModelRequestBudget | undefined;
  readonly #retriever: PublicEvidenceRetriever | undefined;

  constructor(
    private readonly generator: PublicAnswerTextGenerator,
    options: {
      readonly baseline?: DeterministicPublicAnswerService;
      readonly budget?: PublicModelRequestBudget;
      readonly retriever?: PublicEvidenceRetriever;
    } = {},
  ) {
    this.#baseline = options.baseline ?? new DeterministicPublicAnswerService();
    this.#budget = options.budget;
    this.#retriever = options.retriever;
  }

  async execute(
    artifact: PublicCareerEvidenceArtifact,
    request: PortfolioAnswerRequest,
  ): Promise<PublicAnswerExecution> {
    let baseline = this.#baseline.answer(artifact, request);
    if (this.#retriever) {
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
      const answer = generatedAnswerSchema.parse(await this.generator.generate({
        question: request.question,
        evidence: baseline.claims.map((claim, index) => ({
          claimText: claim.text,
          limitations: claim.limitations,
          citationTitle: baseline.citations[index]?.title ?? "Reviewed evidence",
        })),
      }));
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
  if (isHiringValueQuestion(request.question)) {
    return selectHiringValueEvidence(artifact.evidence);
  }
  const queryTerms = tokenizeLexicalTerms(request.question).filter(
    (term) => !PUBLIC_QUERY_STOP_WORDS.has(term),
  );
  return selectLexicalEvidence(artifact.evidence, queryTerms);
}

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

function supportedResponse(
  artifact: PublicCareerEvidenceArtifact,
  selected: readonly PublicCareerEvidenceRecord[],
  hiringValueQuestion = false,
): PortfolioAnswerResponse {
  return portfolioAnswerResponseSchema.parse({
    schemaVersion: PUBLIC_CAREER_EVIDENCE_SCHEMA_VERSION,
    answer: hiringValueQuestion
      ? boundedHiringValueAnswer(selected)
      : boundedSupportedAnswer(selected),
    claims: selected.map((record) => record.claim),
    citations: selected.map((record) => record.citation),
    limitations: unique(hiringValueQuestion
      ? ["A hiring decision should still be based on the role, interviews, and direct references."]
      : selected.flatMap((record) => record.claim.limitations))
      .slice(0, PUBLIC_PORTFOLIO_ANSWER_LIMITS.responseLimitations),
    suggestedFollowUpQuestions: hiringValueQuestion
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

function noEvidenceResponse(
  artifact: PublicCareerEvidenceArtifact,
): PortfolioAnswerResponse {
  return portfolioAnswerResponseSchema.parse({
    schemaVersion: PUBLIC_CAREER_EVIDENCE_SCHEMA_VERSION,
    answer:
      "The reviewed public evidence does not support a reliable answer to that question.",
    claims: [],
    citations: [],
    limitations: ["No matching public-approved evidence was available."],
    suggestedFollowUpQuestions: [
      "Would you like to ask about a published project, professional role, skill, or contribution?",
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
      "The reviewed public evidence contains an unresolved conflict, so it does not support a reliable answer yet.",
    claims: [],
    citations: [],
    limitations: [
      "Conflicting public evidence requires Carl's review before it can support an answer.",
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
  const prefix = "Reviewed public evidence: ";
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
  return `The reviewed public record supports considering Carl for roles that value ${formatNaturalList(strengths)}. The cited evidence below provides the concrete details and boundaries.`;
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
