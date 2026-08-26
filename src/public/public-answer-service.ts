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
  answer(
    artifact: PublicCareerEvidenceArtifact,
    request: PortfolioAnswerRequest,
  ): PortfolioAnswerResponse;
}

export class DeterministicPublicAnswerService
  implements PublicPortfolioAnswerer
{
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

    return selected.length === 0
      ? noEvidenceResponse(artifact, request)
      : supportedResponse(artifact, request, selected);
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
  request: PortfolioAnswerRequest,
  selected: readonly PublicCareerEvidenceRecord[],
): PortfolioAnswerResponse {
  return portfolioAnswerResponseSchema.parse({
    schemaVersion: PUBLIC_CAREER_EVIDENCE_SCHEMA_VERSION,
    answer: `Reviewed public evidence: ${selected
      .map((record) => record.claim.text)
      .join(" ")}`,
    claims: selected.map((record) => record.claim),
    citations: selected.map((record) => record.citation),
    limitations: unique(selected.flatMap((record) => record.claim.limitations)),
    suggestedFollowUpQuestions: [
      "Which cited project or role would you like to examine more closely?",
      "What limitations should we clarify with Carl directly?",
    ],
    corpusVersion: artifact.manifest.corpusVersion,
    ...(request.sessionToken ? { sessionToken: request.sessionToken } : {}),
  });
}

function noEvidenceResponse(
  artifact: PublicCareerEvidenceArtifact,
  request: PortfolioAnswerRequest,
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
    ...(request.sessionToken ? { sessionToken: request.sessionToken } : {}),
  });
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
