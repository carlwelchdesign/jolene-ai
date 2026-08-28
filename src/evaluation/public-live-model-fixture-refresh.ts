import {
  publicCareerEvidenceArtifactSchema,
  type PublicCareerEvidenceArtifact,
} from "../domain/public-career-evidence.js";
import { DeterministicPublicAnswerService } from "../public/public-answer-service.js";
import {
  publicLiveModelEvaluationSuiteSchema,
  type PublicLiveModelEvaluationSuite,
} from "./public-live-model-evaluation.js";

export class PublicLiveModelFixtureRefreshError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublicLiveModelFixtureRefreshError";
  }
}

export function refreshPublicLiveModelEvaluationSuite(input: {
  readonly artifact: PublicCareerEvidenceArtifact;
  readonly template: PublicLiveModelEvaluationSuite;
}): PublicLiveModelEvaluationSuite {
  const artifact = publicCareerEvidenceArtifactSchema.parse(input.artifact);
  const template = publicLiveModelEvaluationSuiteSchema.parse(input.template);
  const answerService = new DeterministicPublicAnswerService();
  const cases = template.cases.map((item) => {
    const answer = answerService.answer(artifact, { question: item.question });
    const expectedEvidenceIds = answer.claims.flatMap((claim) => claim.evidenceIds);
    if (item.expectedMode === "model" && expectedEvidenceIds.length === 0) {
      throw new PublicLiveModelFixtureRefreshError(
        `Supported live case ${item.id} selected no approved evidence.`,
      );
    }
    if (item.expectedMode === "deterministic" && expectedEvidenceIds.length > 0) {
      throw new PublicLiveModelFixtureRefreshError(
        `Provider-bypass live case ${item.id} unexpectedly selected evidence.`,
      );
    }
    return { ...item, expectedEvidenceIds };
  });

  return publicLiveModelEvaluationSuiteSchema.parse({
    ...template,
    generatedAt: artifact.manifest.generatedAt,
    corpusVersion: artifact.manifest.corpusVersion,
    evidence: artifact.evidence,
    revokedEvidenceIds: artifact.manifest.revokedEvidenceIds,
    conflicts: artifact.conflicts,
    cases,
  });
}
