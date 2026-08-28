import { createHash } from "node:crypto";

import { tokenizeLexicalTerms } from "../domain/lexical-terms.js";
import {
  PUBLIC_CAREER_EVIDENCE_SCHEMA_VERSION,
  type PublicCareerEvidenceArtifact,
  type PublicCareerEvidenceRecord,
} from "../domain/public-career-evidence.js";
import {
  PUBLIC_PORTFOLIO_JOB_FIT_LIMITS,
  portfolioJobFitResponseSchema,
  type PortfolioJobFitRequest,
  type PortfolioJobFitResponse,
} from "../domain/public-portfolio-contract.js";
import { createPublicJobDescriptionEnvelope } from "./public-model-data.js";

export interface PublicJobFitComparer {
  compare(
    artifact: PublicCareerEvidenceArtifact,
    request: PortfolioJobFitRequest,
  ): PortfolioJobFitResponse;
}

export class DeterministicPublicJobFitService implements PublicJobFitComparer {
  compare(
    artifact: PublicCareerEvidenceArtifact,
    request: PortfolioJobFitRequest,
  ): PortfolioJobFitResponse {
    const jobDescription = createPublicJobDescriptionEnvelope(
      request.jobDescription,
      new Date().toISOString(),
    );
    if (jobDescription.payload.kind !== "text") {
      throw new Error("Job descriptions require a text envelope.");
    }
    const requirements = segmentRequirements(jobDescription.payload.text);
    const conflictedIds = new Set(
      artifact.conflicts.flatMap((conflict) => conflict.evidenceIds),
    );
    const usableEvidence = artifact.evidence.filter(
      (record) => !conflictedIds.has(record.evidenceId),
    );
    const treatAsUntrustedInstruction = looksLikeInstructionInjection(
      jobDescription.payload.text,
    );
    const results = requirements.map((requirement) =>
      assessRequirement(
        requirement,
        treatAsUntrustedInstruction ? [] : usableEvidence,
      )
    );
    const citedIds = new Set(results.flatMap((result) => result.evidenceIds));

    return portfolioJobFitResponseSchema.parse({
      schemaVersion: PUBLIC_CAREER_EVIDENCE_SCHEMA_VERSION,
      requirements: results,
      citations: artifact.evidence
        .filter((record) => citedIds.has(record.evidenceId))
        .sort((left, right) => left.evidenceId.localeCompare(right.evidenceId))
        .map((record) => record.citation),
      caveats: [
        "This comparison uses only reviewed public evidence and is not a recommendation or blanket fit score.",
        "Unknown means the public corpus does not establish an answer; it does not mean Carl lacks the experience.",
        "The submitted job description is treated as untrusted, ephemeral text and is not persisted.",
        ...(artifact.conflicts.length > 0
          ? ["Evidence in unresolved conflict groups is excluded from requirement assessments."]
          : []),
      ],
      suggestedFollowUpQuestions: [
        "Which requirement should we examine against the cited work in more detail?",
        "Which unknown requirement would you like Carl to clarify directly?",
      ],
      corpusVersion: artifact.manifest.corpusVersion,
    });
  }
}

function assessRequirement(
  requirement: string,
  evidence: readonly PublicCareerEvidenceRecord[],
) {
  const requirementTerms = publicTerms(requirement);
  const matches = evidence
    .map((record) => ({
      record,
      score: overlapScore(record, requirementTerms),
    }))
    .filter((match) => match.score > 0)
    .sort((left, right) =>
      right.score - left.score ||
      left.record.evidenceId.localeCompare(right.record.evidenceId)
    )
    .slice(0, PUBLIC_PORTFOLIO_JOB_FIT_LIMITS.evidencePerRequirement);
  const bestScore = matches[0]?.score ?? 0;
  const coverage = requirementTerms.length === 0
    ? 0
    : bestScore / requirementTerms.length;
  const assessment = bestScore === 0
    ? "unknown" as const
    : bestScore === requirementTerms.length || (bestScore >= 2 && coverage >= 0.6)
      ? "direct" as const
      : "adjacent" as const;
  const evidenceIds = matches.map((match) => match.record.evidenceId);

  return {
    requirementId: requirementId(requirement),
    requirement,
    assessment,
    explanation: assessment === "unknown"
      ? "The reviewed public evidence does not establish this requirement."
      : assessment === "direct"
        ? "Reviewed public evidence directly overlaps the stated requirement."
        : "Reviewed public evidence has relevant overlap, but does not establish the full requirement.",
    evidenceIds,
    limitations: assessment === "unknown"
      ? ["No conclusion about absent experience can be drawn from the public corpus."]
      : unique(matches.flatMap((match) => match.record.claim.limitations)).slice(0, 4),
  };
}

function overlapScore(
  record: PublicCareerEvidenceRecord,
  requirementTerms: readonly string[],
): number {
  const evidenceTerms = new Set(publicTerms([
    record.claim.text,
    record.citation.title,
  ].join(" ")));
  return requirementTerms.reduce(
    (total, term) => total + (evidenceTerms.has(term) ? 1 : 0),
    0,
  );
}

function segmentRequirements(jobDescription: string): string[] {
  const segments = jobDescription
    .split(/\r?\n+/u)
    .flatMap((line) => line.split(/(?<=[.!?;])\s+/u))
    .map((segment) => segment.replace(/^\s*(?:[-*•]|\d+[.)])\s*/u, ""))
    .map((segment) => segment.replace(/\s+/gu, " ").trim())
    .filter(Boolean)
    .map((segment) =>
      segment.slice(0, PUBLIC_PORTFOLIO_JOB_FIT_LIMITS.requirementCharacters)
    );
  return [...new Set(segments)].slice(
    0,
    PUBLIC_PORTFOLIO_JOB_FIT_LIMITS.requirements,
  );
}

function publicTerms(value: string): string[] {
  const normalized = value
    .replace(/c\+\+/giu, " cpp ")
    .replace(/c#/giu, " csharp ")
    .replace(/node\.js/giu, " nodejs ")
    .replace(/next\.js/giu, " nextjs ");
  return tokenizeLexicalTerms(normalized).filter(
    (term) => !PUBLIC_QUERY_STOP_WORDS.has(term),
  );
}

function requirementId(requirement: string): string {
  const normalized = requirement.toLocaleLowerCase("en-US").normalize("NFKC");
  return `req:${createHash("sha256").update(normalized).digest("hex").slice(0, 16)}`;
}

function looksLikeInstructionInjection(value: string): boolean {
  const normalized = value.toLocaleLowerCase("en-US").normalize("NFKC");
  return INSTRUCTION_PATTERNS.some((pattern) => normalized.includes(pattern));
}

const PUBLIC_QUERY_STOP_WORDS = new Set(["carl", "welch"]);
const INSTRUCTION_PATTERNS = [
  "ignore previous",
  "ignore all instructions",
  "system prompt",
  "private memory",
  "reveal secrets",
  "api key",
] as const;

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
