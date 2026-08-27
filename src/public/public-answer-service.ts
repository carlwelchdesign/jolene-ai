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

export interface PublicPortfolioAnswerer {
  execute(
    artifact: PublicCareerEvidenceArtifact,
    request: PortfolioAnswerRequest,
  ): PublicAnswerExecution | Promise<PublicAnswerExecution>;
}

export interface PublicAnswerExecution {
  readonly response: PortfolioAnswerResponse;
  readonly mode: "deterministic" | "model" | "fallback";
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
    const queryTerms = tokenizeLexicalTerms(request.question).filter(
      (term) => !PUBLIC_QUERY_STOP_WORDS.has(term),
    );
    const selected = artifact.evidence
      .map((record) => ({ record, score: score(record, queryTerms) }))
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) =>
        right.score - left.score ||
        left.record.evidenceId.localeCompare(right.record.evidenceId)
      )
      .slice(0, PUBLIC_PORTFOLIO_ANSWER_LIMITS.responseItems)
      .map((candidate) => candidate.record);
    const conflict = artifact.conflicts.find((candidate) =>
      candidate.evidenceIds.some((evidenceId) =>
        selected.some((record) => record.evidenceId === evidenceId)
      )
    );

    return conflict
      ? conflictResponse(artifact)
      : selected.length === 0
      ? noEvidenceResponse(artifact)
      : supportedResponse(artifact, selected);
  }
}

const generatedAnswerSchema = z.string().trim().min(1).max(2_000);

export class GroundedPublicAnswerService implements PublicPortfolioAnswerer {
  constructor(
    private readonly generator: PublicAnswerTextGenerator,
    private readonly baseline = new DeterministicPublicAnswerService(),
  ) {}

  async execute(
    artifact: PublicCareerEvidenceArtifact,
    request: PortfolioAnswerRequest,
  ): Promise<PublicAnswerExecution> {
    const baseline = this.baseline.answer(artifact, request);
    if (baseline.claims.length === 0) {
      return { response: baseline, mode: "deterministic" };
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

const PUBLIC_QUERY_STOP_WORDS = new Set(["carl", "welch"]);

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

function supportedResponse(
  artifact: PublicCareerEvidenceArtifact,
  selected: readonly PublicCareerEvidenceRecord[],
): PortfolioAnswerResponse {
  return portfolioAnswerResponseSchema.parse({
    schemaVersion: PUBLIC_CAREER_EVIDENCE_SCHEMA_VERSION,
    answer: boundedSupportedAnswer(selected),
    claims: selected.map((record) => record.claim),
    citations: selected.map((record) => record.citation),
    limitations: unique(selected.flatMap((record) => record.claim.limitations))
      .slice(0, PUBLIC_PORTFOLIO_ANSWER_LIMITS.responseLimitations),
    suggestedFollowUpQuestions: [
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
