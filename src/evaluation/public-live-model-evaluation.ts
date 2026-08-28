import { createHash } from "node:crypto";

import { z } from "zod";

import {
  assertPublicResponseDisclosureSafe,
} from "../domain/public-disclosure-policy.js";
import {
  PUBLIC_CAREER_EVIDENCE_SCHEMA_VERSION,
  careerEvidenceIdSchema,
  publicCareerEvidenceConflictSchema,
  publicCareerEvidenceArtifactSchema,
  publicCareerEvidenceDigest,
  publicCareerEvidenceRecordSchema,
  type PublicCareerEvidenceArtifact,
} from "../domain/public-career-evidence.js";
import {
  portfolioAnswerResponseSchema,
} from "../domain/public-portfolio-contract.js";
import type {
  MeasuredPublicAnswerGeneration,
} from "../public/openai-public-answer-generator.js";
import {
  DeterministicPublicAnswerService,
  type GroundedPublicAnswerInput,
} from "../public/public-answer-service.js";
import type { PublicAnswerGroundingResult } from
  "../public/public-answer-grounding-contract.js";
import { PublicAnswerGroundingValidator } from
  "../public/public-answer-grounding-validator.js";

const evidenceIdSchema = z.string().regex(
  /^career:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
);

export const publicLiveModelMetricSchema = z.enum([
  "evidence_selection",
  "provider_bypass",
  "provider_success",
  "contract_validity",
  "grounding_invariance",
  "semantic_response_integrity",
  "model_version_integrity",
  "corpus_version_integrity",
  "disclosure_safety",
  "latency_budget",
  "input_token_budget",
  "output_token_budget",
  "cost_budget",
]);

const thresholdSchema = z.object({
  minimumPassRateBps: z.number().int().min(0).max(10_000),
  blockingSeverity: z.enum(["blocker", "major"]),
}).strict();

export const publicLiveModelEvaluationSuiteSchema = z.object({
  suiteVersion: z.literal("1.1.0"),
  suiteId: z.string().regex(/^public-live-model:[a-z0-9][a-z0-9-]{2,80}$/),
  generatedAt: z.string().datetime({ offset: true }),
  model: z.string().trim().min(1).max(120),
  corpusVersion: z.string().regex(/^career:[a-f0-9]{64}$/u),
  pricing: z.object({
    reviewedAt: z.string().date(),
    sourceUrl: z.string().url().max(2_000),
    inputUsdPerMillionTokens: z.number().nonnegative().max(1_000),
    outputUsdPerMillionTokens: z.number().nonnegative().max(1_000),
  }).strict(),
  budgets: z.object({
    maxLatencyMilliseconds: z.number().int().positive().max(60_000),
    maxInputTokensPerRequest: z.number().int().positive().max(100_000),
    maxOutputTokensPerRequest: z.number().int().positive().max(10_000),
    maxEstimatedCostMicrousdPerRequest: z.number().int().positive().max(1_000_000),
    maxEstimatedCostMicrousdTotal: z.number().int().positive().max(10_000_000),
  }).strict(),
  thresholds: z.record(publicLiveModelMetricSchema, thresholdSchema),
  evidence: z.array(publicCareerEvidenceRecordSchema).min(1).max(50),
  revokedEvidenceIds: z.array(careerEvidenceIdSchema).max(1_000).default([]),
  conflicts: z.array(publicCareerEvidenceConflictSchema).max(100).default([]),
  cases: z.array(z.object({
    id: z.string().regex(/^live:[a-z0-9][a-z0-9-]{2,80}$/),
    question: z.string().trim().min(1).max(800),
    expectedMode: z.enum(["model", "deterministic"]),
    expectedEvidenceIds: z.array(evidenceIdSchema).max(5),
    humanReviewRequired: z.literal(true),
  }).strict().superRefine((item, context) => {
    if (item.expectedMode === "model" && item.expectedEvidenceIds.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["expectedEvidenceIds"],
        message: "Model cases require expected grounding evidence.",
      });
    }
    if (
      item.expectedMode === "deterministic" &&
      item.expectedEvidenceIds.length > 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["expectedEvidenceIds"],
        message: "Provider-bypass cases cannot expect grounding evidence.",
      });
    }
  })).min(2).max(20).superRefine((cases, context) => {
    const ids = cases.map((item) => item.id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: "custom", message: "Live case IDs must be unique." });
    }
    if (!cases.some((item) => item.expectedMode === "model")) {
      context.addIssue({ code: "custom", message: "At least one model case is required." });
    }
    if (!cases.some((item) => item.expectedMode === "deterministic")) {
      context.addIssue({ code: "custom", message: "At least one bypass case is required." });
    }
  }),
}).strict();

export type PublicLiveModelEvaluationSuite = z.infer<
  typeof publicLiveModelEvaluationSuiteSchema
>;
export type PublicLiveModelMetric = z.infer<typeof publicLiveModelMetricSchema>;

export interface MeasuredPublicAnswerGenerator {
  generateMeasured(
    input: GroundedPublicAnswerInput,
  ): Promise<MeasuredPublicAnswerGeneration>;
}

interface EvaluationAssertion {
  readonly metric: PublicLiveModelMetric;
  readonly passed: boolean;
  readonly reason: string;
}

export interface PublicLiveModelEvaluationReport {
  readonly suiteVersion: "1.1.0";
  readonly suiteId: string;
  readonly suiteHash: string;
  readonly model: string;
  readonly corpusVersion: string;
  readonly gate: "pass" | "fail";
  readonly humanReview: "required";
  readonly counts: {
    readonly cases: number;
    readonly passed: number;
    readonly failed: number;
    readonly providerRequests: number;
  };
  readonly totals: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly totalTokens: number;
    readonly estimatedCostMicrousd: number;
    readonly maximumLatencyMilliseconds: number;
  };
  readonly metrics: readonly {
    readonly id: PublicLiveModelMetric;
    readonly passed: number;
    readonly total: number;
    readonly passRateBps: number;
    readonly minimumPassRateBps: number;
    readonly blockingSeverity: "blocker" | "major";
    readonly gate: "pass" | "fail";
  }[];
  readonly cases: readonly {
    readonly id: string;
    readonly mode: "model" | "deterministic" | "fallback";
    readonly status: "pass" | "fail";
    readonly failures: readonly string[];
    readonly latencyMilliseconds: number;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly estimatedCostMicrousd: number;
    readonly grounding: {
      readonly status: "accepted" | "rejected" | "not_evaluated";
      readonly reasonCode: string | null;
      readonly segmentIndex: number | null;
    };
  }[];
}

export const publicLiveModelReviewPacketSchema = z.object({
  suiteVersion: z.literal("1.1.0"),
  suiteId: z.string().regex(/^public-live-model:[a-z0-9][a-z0-9-]{2,80}$/),
  suiteHash: z.string().regex(/^[a-f0-9]{64}$/),
  model: z.string().trim().min(1).max(120),
  corpusVersion: z.string().regex(/^career:[a-f0-9]{64}$/u),
  generatedAt: z.string().datetime({ offset: true }),
  humanReview: z.literal("required"),
  cases: z.array(z.object({
    id: z.string().regex(/^live:[a-z0-9][a-z0-9-]{2,80}$/),
    question: z.string().trim().min(1).max(800),
    mode: z.enum(["model", "deterministic", "fallback"]),
    answer: z.string().trim().min(1).max(4_000),
    rejectedCandidateAnswer: z.string().trim().min(1).max(4_000).nullable()
      .default(null),
    evidence: z.array(z.object({
      evidenceId: evidenceIdSchema,
      claimText: z.string().trim().min(1).max(4_000),
      limitations: z.array(z.string().trim().min(1).max(2_000)).max(8),
      citationTitle: z.string().trim().min(1).max(240),
    }).strict()).max(5),
  }).strict()).min(2).max(20).superRefine((cases, context) => {
    const ids = cases.map((item) => item.id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: "custom", message: "Review case IDs must be unique." });
    }
  }),
}).strict();

export type PublicLiveModelReviewPacket = z.infer<
  typeof publicLiveModelReviewPacketSchema
>;

export interface PublicLiveModelEvaluationResult {
  readonly report: PublicLiveModelEvaluationReport;
  readonly reviewPacket: PublicLiveModelReviewPacket;
}

export async function evaluatePublicLiveModelSuite(
  input: unknown,
  generator: MeasuredPublicAnswerGenerator,
  nowMilliseconds: () => number = Date.now,
): Promise<PublicLiveModelEvaluationResult> {
  const suite = publicLiveModelEvaluationSuiteSchema.parse(input);
  const suiteHash = hashPublicLiveModelSuite(suite);
  const artifact = createPublicLiveModelArtifact(suite);
  const corpusMatches = artifact.manifest.corpusVersion === suite.corpusVersion;
  const baselineService = new DeterministicPublicAnswerService();
  const groundingValidator = new PublicAnswerGroundingValidator();
  const results: Array<{
    id: string;
    mode: "model" | "deterministic" | "fallback";
    assertions: readonly EvaluationAssertion[];
    latencyMilliseconds: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostMicrousd: number;
    providerRequested: boolean;
    question: string;
    answer: string;
    evidence: PublicLiveModelReviewPacket["cases"][number]["evidence"];
    groundingAudit: PublicAnswerGroundingResult | null;
    rejectedCandidateAnswer: string | null;
  }> = [];

  for (const item of suite.cases) {
    const baseline = baselineService.answer(artifact, { question: item.question });
    const selectedIds = baseline.claims.flatMap((claim) => claim.evidenceIds);
    const evidenceMatches = sameStrings(selectedIds, item.expectedEvidenceIds);
    const evidence = baseline.claims.map((claim, index) => ({
      evidenceId: claim.evidenceIds[0] ?? "",
      claimText: claim.text,
      limitations: claim.limitations,
      citationTitle: baseline.citations[index]?.title ?? "Reviewed evidence",
    }));
    const evidenceAssertion: EvaluationAssertion = {
      metric: "evidence_selection",
      passed: evidenceMatches,
      reason: evidenceMatches ? "expected_evidence_selected" : "unexpected_evidence_selection",
    };
    const corpusAssertion = assertion(
      "corpus_version_integrity",
      corpusMatches,
      "corpus_version_matched",
      "corpus_version_drift",
    );

    if (!corpusMatches) {
      results.push({
        id: item.id,
        mode: "fallback",
        assertions: [
          corpusAssertion,
          evidenceAssertion,
          ...failedPreselectionAssertions("corpus_version_drift"),
        ],
        latencyMilliseconds: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimatedCostMicrousd: 0,
        providerRequested: false,
        question: item.question,
        answer: baseline.answer,
        evidence,
        groundingAudit: null,
        rejectedCandidateAnswer: null,
      });
      continue;
    }

    if (item.expectedMode === "deterministic") {
      const bypassed = baseline.claims.length === 0;
      results.push({
        id: item.id,
        mode: "deterministic",
        assertions: [
          corpusAssertion,
          evidenceAssertion,
          {
            metric: "provider_bypass",
            passed: bypassed,
            reason: bypassed ? "provider_bypassed" : "provider_not_bypassed",
          },
        ],
        latencyMilliseconds: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimatedCostMicrousd: 0,
        providerRequested: false,
        question: item.question,
        answer: baseline.answer,
        evidence,
        groundingAudit: null,
        rejectedCandidateAnswer: null,
      });
      continue;
    }

    if (!evidenceMatches || baseline.claims.length === 0) {
      results.push({
        id: item.id,
        mode: "fallback",
        assertions: [
          corpusAssertion,
          evidenceAssertion,
          ...failedPreselectionAssertions("provider_bypassed_after_evidence_mismatch"),
        ],
        latencyMilliseconds: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimatedCostMicrousd: 0,
        providerRequested: false,
        question: item.question,
        answer: baseline.answer,
        evidence,
        groundingAudit: null,
        rejectedCandidateAnswer: null,
      });
      continue;
    }

    const groundedInput: GroundedPublicAnswerInput = {
      question: item.question,
      corpusVersion: artifact.manifest.corpusVersion,
      evidence: evidence.map((record) => ({
        evidenceId: record.evidenceId,
        claimText: record.claimText,
        limitations: record.limitations,
        citationTitle: record.citationTitle,
      })),
    };
    const startedAt = nowMilliseconds();
    try {
      const generation = await generator.generateMeasured(groundedInput);
      const latencyMilliseconds = Math.max(0, nowMilliseconds() - startedAt);
      const estimatedCostMicrousd = estimateCostMicrousd(suite, generation);
      const modelMatches = generation.model === suite.model;
      const semanticValidation = groundingValidator.validate(
        artifact,
        baseline,
        generation.groundedGeneration,
      );
      const semanticallyValid = semanticValidation.status === "accepted" &&
        semanticValidation.answer === generation.answer;
      const candidate = portfolioAnswerResponseSchema.safeParse({
        ...baseline,
        answer: semanticValidation.status === "accepted"
          ? semanticValidation.answer
          : baseline.answer,
      });
      const contractValid = candidate.success && semanticallyValid;
      const invariant = contractValid && responseInvariant(
        baseline,
        candidate.data,
      );
      let disclosureSafe = false;
      if (contractValid) {
        try {
          assertPublicResponseDisclosureSafe(candidate.data);
          disclosureSafe = true;
        } catch {
          disclosureSafe = false;
        }
      }
      results.push({
        id: item.id,
        mode: contractValid && disclosureSafe && modelMatches ? "model" : "fallback",
        assertions: [
          corpusAssertion,
          evidenceAssertion,
          assertion("provider_success", true, "provider_response_received", "provider_call_failed"),
          assertion("model_version_integrity", modelMatches, "model_version_matched", "model_version_drift"),
          assertion("contract_validity", contractValid, "response_contract_valid", "response_contract_invalid"),
          assertion("grounding_invariance", invariant, "grounding_preserved", "grounding_changed"),
          assertion("semantic_response_integrity", semanticallyValid, "semantic_response_supported", "semantic_response_unsupported"),
          assertion(
            "disclosure_safety",
            disclosureSafe,
            "response_disclosure_safe",
            contractValid
              ? "response_disclosure_blocked"
              : "response_disclosure_not_evaluated",
          ),
          assertion("latency_budget", latencyMilliseconds <= suite.budgets.maxLatencyMilliseconds, "latency_within_budget", "latency_budget_exceeded"),
          assertion("input_token_budget", generation.inputTokens <= suite.budgets.maxInputTokensPerRequest, "input_tokens_within_budget", "input_token_budget_exceeded"),
          assertion("output_token_budget", generation.outputTokens <= suite.budgets.maxOutputTokensPerRequest, "output_tokens_within_budget", "output_token_budget_exceeded"),
          assertion("cost_budget", estimatedCostMicrousd <= suite.budgets.maxEstimatedCostMicrousdPerRequest, "request_cost_within_budget", "request_cost_budget_exceeded"),
        ],
        latencyMilliseconds,
        inputTokens: generation.inputTokens,
        outputTokens: generation.outputTokens,
        totalTokens: generation.totalTokens,
        estimatedCostMicrousd,
        providerRequested: true,
        question: item.question,
        answer: contractValid && disclosureSafe && modelMatches
          ? candidate.data.answer
          : baseline.answer,
        evidence,
        groundingAudit: semanticValidation.audit,
        rejectedCandidateAnswer: semanticValidation.status === "rejected"
          ? generation.answer
          : null,
      });
    } catch {
      const latencyMilliseconds = Math.max(0, nowMilliseconds() - startedAt);
      results.push({
        id: item.id,
        mode: "fallback",
        assertions: [
          corpusAssertion,
          evidenceAssertion,
          ...failedProviderAssertions(latencyMilliseconds, suite),
        ],
        latencyMilliseconds,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimatedCostMicrousd: 0,
        providerRequested: true,
        question: item.question,
        answer: baseline.answer,
        evidence,
        groundingAudit: null,
        rejectedCandidateAnswer: null,
      });
    }
  }

  const totalEstimatedCostMicrousd = sum(results, "estimatedCostMicrousd");
  const aggregateCostAssertion = assertion(
    "cost_budget",
    totalEstimatedCostMicrousd <= suite.budgets.maxEstimatedCostMicrousdTotal,
    "total_cost_within_budget",
    "total_cost_budget_exceeded",
  );
  const allAssertions = [
    ...results.flatMap((result) => result.assertions),
    aggregateCostAssertion,
  ];
  const metrics = publicLiveModelMetricSchema.options.map((id) => {
    const assertions = allAssertions.filter((item) => item.metric === id);
    const passed = assertions.filter((item) => item.passed).length;
    const passRateBps = assertions.length === 0
      ? 0
      : Math.floor((passed * 10_000) / assertions.length);
    const threshold = suite.thresholds[id];
    return {
      id,
      passed,
      total: assertions.length,
      passRateBps,
      minimumPassRateBps: threshold.minimumPassRateBps,
      blockingSeverity: threshold.blockingSeverity,
      gate: assertions.length > 0 && passRateBps >= threshold.minimumPassRateBps
        ? "pass" as const
        : "fail" as const,
    };
  });
  const cases = results.map((result) => {
    const failures = result.assertions.filter((item) => !item.passed)
      .map((item) => item.reason);
    return {
      id: result.id,
      mode: result.mode,
      status: failures.length === 0 ? "pass" as const : "fail" as const,
      failures,
      latencyMilliseconds: result.latencyMilliseconds,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      estimatedCostMicrousd: result.estimatedCostMicrousd,
      grounding: result.groundingAudit === null
        ? { status: "not_evaluated" as const, reasonCode: null, segmentIndex: null }
        : result.groundingAudit.status === "accepted"
        ? { status: "accepted" as const, reasonCode: null, segmentIndex: null }
        : {
          status: "rejected" as const,
          reasonCode: result.groundingAudit.reasonCode,
          segmentIndex: result.groundingAudit.segmentIndex,
        },
    };
  });
  const gate = metrics.some((metric) =>
      metric.blockingSeverity === "blocker" && metric.gate === "fail"
    ) || cases.some((item) => item.status === "fail")
    ? "fail" as const
    : "pass" as const;

  return {
    report: {
      suiteVersion: suite.suiteVersion,
      suiteId: suite.suiteId,
      suiteHash,
      model: suite.model,
      corpusVersion: suite.corpusVersion,
      gate,
      humanReview: "required",
      counts: {
        cases: cases.length,
        passed: cases.filter((item) => item.status === "pass").length,
        failed: cases.filter((item) => item.status === "fail").length,
        providerRequests: results.filter((item) => item.providerRequested).length,
      },
      totals: {
        inputTokens: sum(results, "inputTokens"),
        outputTokens: sum(results, "outputTokens"),
        totalTokens: sum(results, "totalTokens"),
        estimatedCostMicrousd: totalEstimatedCostMicrousd,
        maximumLatencyMilliseconds: Math.max(
          0,
          ...results.map((item) => item.latencyMilliseconds),
        ),
      },
      metrics,
      cases,
    },
    reviewPacket: {
      suiteVersion: suite.suiteVersion,
      suiteId: suite.suiteId,
      suiteHash,
      model: suite.model,
      corpusVersion: suite.corpusVersion,
      generatedAt: new Date(nowMilliseconds()).toISOString(),
      humanReview: "required",
      cases: results.map((result) => ({
        id: result.id,
        question: result.question,
        mode: result.mode,
        answer: result.answer,
        rejectedCandidateAnswer: result.rejectedCandidateAnswer,
        evidence: result.evidence,
      })),
    },
  };
}

export function createPublicLiveModelArtifact(
  suite: PublicLiveModelEvaluationSuite,
): PublicCareerEvidenceArtifact {
  const digest = publicCareerEvidenceDigest({
    evidence: suite.evidence,
    conflicts: suite.conflicts,
    revokedEvidenceIds: suite.revokedEvidenceIds,
  });
  return publicCareerEvidenceArtifactSchema.parse({
    manifest: {
      schemaVersion: PUBLIC_CAREER_EVIDENCE_SCHEMA_VERSION,
      corpusVersion: `career:${digest}`,
      corpusHash: `sha256:${digest}`,
      generatedAt: suite.generatedAt,
      reviewedAt: suite.generatedAt,
      evidenceCount: suite.evidence.length,
      revokedEvidenceIds: suite.revokedEvidenceIds,
    },
    evidence: suite.evidence,
    conflicts: suite.conflicts,
  });
}

function estimateCostMicrousd(
  suite: PublicLiveModelEvaluationSuite,
  generation: MeasuredPublicAnswerGeneration,
): number {
  return Math.ceil(
    generation.inputTokens * suite.pricing.inputUsdPerMillionTokens +
      generation.outputTokens * suite.pricing.outputUsdPerMillionTokens,
  );
}

function assertion(
  metric: PublicLiveModelMetric,
  passed: boolean,
  passReason: string,
  failReason: string,
): EvaluationAssertion {
  return { metric, passed, reason: passed ? passReason : failReason };
}

function failedProviderAssertions(
  latencyMilliseconds: number,
  suite: PublicLiveModelEvaluationSuite,
): readonly EvaluationAssertion[] {
  return [
    assertion("provider_success", false, "provider_response_received", "provider_call_failed"),
    assertion("model_version_integrity", false, "model_version_matched", "provider_call_failed"),
    assertion("contract_validity", false, "response_contract_valid", "provider_call_failed"),
    assertion("grounding_invariance", false, "grounding_preserved", "provider_call_failed"),
    assertion("semantic_response_integrity", false, "semantic_response_supported", "provider_call_failed"),
    assertion("disclosure_safety", false, "response_disclosure_safe", "provider_call_failed"),
    assertion("latency_budget", latencyMilliseconds <= suite.budgets.maxLatencyMilliseconds, "latency_within_budget", "latency_budget_exceeded"),
    assertion("input_token_budget", false, "input_tokens_within_budget", "usage_unavailable"),
    assertion("output_token_budget", false, "output_tokens_within_budget", "usage_unavailable"),
    assertion("cost_budget", false, "request_cost_within_budget", "usage_unavailable"),
  ];
}

function failedPreselectionAssertions(reason: string): readonly EvaluationAssertion[] {
  return [
    assertion("provider_success", false, "provider_response_received", reason),
    assertion("model_version_integrity", false, "model_version_matched", reason),
    assertion("contract_validity", false, "response_contract_valid", reason),
    assertion("grounding_invariance", false, "grounding_preserved", reason),
    assertion("semantic_response_integrity", false, "semantic_response_supported", reason),
    assertion("disclosure_safety", false, "response_disclosure_safe", reason),
    assertion("latency_budget", true, "latency_within_budget", "latency_budget_exceeded"),
    assertion("input_token_budget", false, "input_tokens_within_budget", "usage_unavailable"),
    assertion("output_token_budget", false, "output_tokens_within_budget", "usage_unavailable"),
    assertion("cost_budget", false, "request_cost_within_budget", "usage_unavailable"),
  ];
}

function responseInvariant(
  baseline: ReturnType<DeterministicPublicAnswerService["answer"]>,
  candidate: ReturnType<DeterministicPublicAnswerService["answer"]>,
): boolean {
  const { answer: _baselineAnswer, ...baselineGrounding } = baseline;
  const { answer: _candidateAnswer, ...candidateGrounding } = candidate;
  return JSON.stringify(baselineGrounding) === JSON.stringify(candidateGrounding);
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sum<T extends Record<string, unknown>>(
  values: readonly T[],
  key: keyof T,
): number {
  return values.reduce((total, item) => total + Number(item[key]), 0);
}

export function hashPublicLiveModelSuite(
  suite: PublicLiveModelEvaluationSuite,
): string {
  return createHash("sha256").update(JSON.stringify(suite)).digest("hex");
}
