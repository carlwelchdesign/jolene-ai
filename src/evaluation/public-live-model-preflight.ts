import { z } from "zod";

import {
  createOpenAIPublicAnswerRequest,
} from "../public/openai-public-answer-generator.js";
import {
  publicGroundedAnswerEnvelopes,
} from "../public/public-model-data.js";
import {
  createPublicLiveModelArtifact,
  hashPublicLiveModelSuite,
  publicLiveModelEvaluationSuiteSchema,
} from "./public-live-model-evaluation.js";
import { refreshPublicLiveModelEvaluationSuite } from
  "./public-live-model-fixture-refresh.js";

const priorReportSchema = z.object({
  suiteHash: z.string().regex(/^[a-f0-9]{64}$/u),
  model: z.string(),
  corpusVersion: z.string(),
  cases: z.array(z.object({
    id: z.string(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    grounding: z.object({ status: z.string() }).passthrough().optional(),
  }).passthrough()),
}).passthrough();

export function preflightPublicLiveModelSuite(
  suiteInput: unknown,
  priorReportInput: unknown,
) {
  const suite = publicLiveModelEvaluationSuiteSchema.parse(suiteInput);
  const prior = priorReportSchema.parse(priorReportInput);
  const suiteHash = hashPublicLiveModelSuite(suite);
  if (
    prior.suiteHash !== suiteHash ||
    prior.model !== suite.model ||
    prior.corpusVersion !== suite.corpusVersion
  ) throw new Error("Prior live measurement does not match the exact suite.");

  const artifact = createPublicLiveModelArtifact(suite);
  const refreshed = refreshPublicLiveModelEvaluationSuite({ artifact, template: suite });
  const records = new Map(suite.evidence.map((record) => [record.evidenceId, record]));
  const priorCases = new Map(prior.cases.map((item) => [item.id, item]));
  const observedAt = suite.generatedAt;
  const cases = refreshed.cases.map((item) => {
    if (item.expectedMode === "deterministic") {
      return {
        id: item.id,
        mode: "deterministic" as const,
        requestDataCharacters: 0,
        priorRequestDataCharacters: 0,
        reductionBps: 0,
        conservativeInputTokenCeiling: 0,
        observedOutputTokens: 0,
        estimatedCostMicrousd: 0,
        gate: "pass" as const,
      };
    }
    const priorCase = priorCases.get(item.id);
    if (!priorCase || priorCase.inputTokens === 0) {
      throw new Error(`Missing prior provider measurement for ${item.id}.`);
    }
    const input = {
      question: item.question,
      corpusVersion: suite.corpusVersion,
      evidence: item.expectedEvidenceIds.map((evidenceId) => {
        const record = records.get(evidenceId);
        if (!record) throw new Error(`Missing selected evidence ${evidenceId}.`);
        return {
          evidenceId,
          claimText: record.claim.text,
          limitations: record.claim.limitations,
          citationTitle: record.citation.title,
        };
      }),
    };
    const request = createOpenAIPublicAnswerRequest({
      input,
      model: suite.model,
      maxOutputTokens: suite.budgets.maxOutputTokensPerRequest,
      observedAt,
    });
    assertRequestBoundary(request, suite.model, suite.corpusVersion);
    const requestDataCharacters = String(request.input).length;
    const priorRequestDataCharacters = JSON.stringify(
      publicGroundedAnswerEnvelopes(input, observedAt),
    ).length;
    const removedCharacters = Math.max(
      0,
      priorRequestDataCharacters - requestDataCharacters,
    );
    // Five removed ASCII/JSON characters count as at least one avoided token in
    // this calibrated ceiling. This intentionally understates the measured
    // reduction rather than pretending to be a model tokenizer.
    const conservativeInputTokenCeiling = priorCase.grounding
      ? priorCase.inputTokens
      : Math.max(
        0,
        priorCase.inputTokens - Math.floor(removedCharacters / 5),
      );
    const estimatedCostMicrousd = Math.ceil(
      conservativeInputTokenCeiling * suite.pricing.inputUsdPerMillionTokens +
      priorCase.outputTokens * suite.pricing.outputUsdPerMillionTokens,
    );
    const gate = conservativeInputTokenCeiling <=
        suite.budgets.maxInputTokensPerRequest &&
        estimatedCostMicrousd <= suite.budgets.maxEstimatedCostMicrousdPerRequest
      ? "pass" as const
      : "fail" as const;
    return {
      id: item.id,
      mode: "model" as const,
      requestDataCharacters,
      priorRequestDataCharacters,
      reductionBps: Math.floor(
        removedCharacters * 10_000 / priorRequestDataCharacters,
      ),
      conservativeInputTokenCeiling,
      observedOutputTokens: priorCase.outputTokens,
      estimatedCostMicrousd,
      gate,
    };
  });
  const totalEstimatedCostMicrousd = cases.reduce(
    (total, item) => total + item.estimatedCostMicrousd,
    0,
  );
  const gate = cases.every((item) => item.gate === "pass") &&
      totalEstimatedCostMicrousd <= suite.budgets.maxEstimatedCostMicrousdTotal
    ? "pass" as const
    : "fail" as const;
  return {
    suiteVersion: suite.suiteVersion,
    suiteId: suite.suiteId,
    suiteHash,
    model: suite.model,
    corpusVersion: suite.corpusVersion,
    gate,
    counts: {
      cases: cases.length,
      providerRequests: cases.filter((item) => item.mode === "model").length,
      providerBypasses: cases.filter((item) => item.mode === "deterministic").length,
    },
    totalEstimatedCostMicrousd,
    cases,
  };
}

function assertRequestBoundary(
  request: ReturnType<typeof createOpenAIPublicAnswerRequest>,
  model: string,
  corpusVersion: string,
): void {
  const input = JSON.parse(String(request.input)) as Record<string, unknown>;
  const boundary = input.securityBoundary as Record<string, unknown> | undefined;
  if (
    request.model !== model || request.store !== false ||
    request.text.format.type !== "json_schema" ||
    request.text.format.strict !== true ||
    boundary?.authority !== "none" ||
    boundary.handling !== "untrusted_data_only" ||
    input.corpusVersion !== corpusVersion
  ) throw new Error("Public model request boundary drifted.");
}
