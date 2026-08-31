import { createHash } from "node:crypto";

import { z } from "zod";

import {
  portfolioAnswerResponseSchema,
  type PublicConversationContext,
} from "../domain/public-portfolio-contract.js";
import {
  publicCareerEvidenceArtifactSchema,
  type PublicCareerEvidenceArtifact,
} from "../domain/public-career-evidence.js";
import { containsInternalPublicProcessLanguage } from
  "../public/public-visitor-language.js";
import type { PublicAnswerExecution } from "../public/public-answer-service.js";
import {
  type WorldClassPublicChatCase,
  worldClassPublicChatSuiteSchema,
} from "./world-class-public-chat-suite.js";

const usageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  estimatedCostMicrousd: z.number().int().nonnegative(),
}).strict();

export interface WorldClassPublicChatResponder {
  respond(input: {
    readonly question: string;
    readonly conversationContext?: PublicConversationContext;
  }): Promise<{
    readonly execution: PublicAnswerExecution;
    readonly usage?: z.infer<typeof usageSchema>;
  }>;
}

type MachineMetric =
  | "citation_precision"
  | "unsupported_claims"
  | "entity_routing"
  | "relevant_outcome"
  | "continuity"
  | "injection_privacy"
  | "internal_language"
  | "latency";

type Assertion = {
  readonly metric: MachineMetric;
  readonly passed: boolean;
  readonly reason: string;
};

type TurnReview = {
  readonly turn: number;
  readonly prompt: string;
  readonly expectedIntent: WorldClassPublicChatCase["turns"][number]["expectedIntent"];
  readonly expectedResponseKind: PublicAnswerExecution["responseKind"];
  readonly expectedEntity: string | null;
  readonly answer: string;
  readonly mode: PublicAnswerExecution["mode"];
  readonly responseKind: PublicAnswerExecution["responseKind"];
  readonly claims: readonly {
    readonly claimId: string;
    readonly text: string;
    readonly evidenceIds: readonly string[];
  }[];
  readonly citations: readonly {
    readonly evidenceId: string;
    readonly title: string;
    readonly href: string;
  }[];
  readonly limitations: readonly string[];
  readonly followUps: readonly string[];
  readonly latencyMilliseconds: number;
  readonly usage: z.infer<typeof usageSchema>;
  readonly machineFailures: readonly string[];
};

type CaseReview = {
  readonly id: string;
  readonly category: WorldClassPublicChatCase["category"];
  readonly kind: WorldClassPublicChatCase["kind"];
  readonly mutation: string;
  readonly humanReviewRequired: true;
  readonly turns: readonly TurnReview[];
  readonly scores: null;
  readonly reviewerHardFailures: readonly string[];
  readonly reviewerNotes: null;
};

type CaseResult = {
  readonly id: string;
  readonly category: WorldClassPublicChatCase["category"];
  readonly kind: WorldClassPublicChatCase["kind"];
  readonly status: "pass" | "fail";
  readonly failures: readonly string[];
};

export async function evaluateWorldClassPublicChatSuite(
  suiteInput: unknown,
  artifactInput: unknown,
  responder: WorldClassPublicChatResponder,
  nowMilliseconds: () => number = Date.now,
) {
  const suite = worldClassPublicChatSuiteSchema.parse(suiteInput);
  const artifact = publicCareerEvidenceArtifactSchema.parse(artifactInput);
  const artifactEvidence = new Map(
    artifact.evidence.map((record) => [record.evidenceId, record]),
  );
  const caseResults: CaseResult[] = [];
  const reviewCases: CaseReview[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalEstimatedCostMicrousd = 0;

  for (const testCase of suite.cases) {
    let conversationContext: PublicConversationContext | undefined;
    const turns: TurnReview[] = [];
    const assertions: Assertion[] = [];
    for (const [turnIndex, expected] of testCase.turns.entries()) {
      const startedAt = nowMilliseconds();
      const result = await responder.respond({
        question: expected.prompt,
        ...(conversationContext ? { conversationContext } : {}),
      });
      const latencyMilliseconds = Math.max(0, nowMilliseconds() - startedAt);
      const response = portfolioAnswerResponseSchema.parse(result.execution.response);
      conversationContext = response.conversationContext;
      const usage = result.usage ?? {
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostMicrousd: 0,
      };
      totalInputTokens += usage.inputTokens;
      totalOutputTokens += usage.outputTokens;
      totalEstimatedCostMicrousd += usage.estimatedCostMicrousd;
      const turnAssertions = evaluateTurn(
        artifactEvidence,
        testCase,
        turnIndex,
        expected,
        result.execution,
        latencyMilliseconds,
        suite.thresholds.p95LatencyMillisecondsMaximum,
      );
      assertions.push(...turnAssertions);
      turns.push({
        turn: turnIndex + 1,
        prompt: expected.prompt,
        expectedIntent: expected.expectedIntent,
        expectedResponseKind: expected.expectedResponseKind,
        expectedEntity: expected.expectedEntity ?? null,
        answer: response.answer,
        mode: result.execution.mode,
        responseKind: result.execution.responseKind,
        claims: response.claims.map((claim) => ({
          claimId: claim.claimId,
          text: claim.text,
          evidenceIds: claim.evidenceIds,
        })),
        citations: response.citations.map((citation) => ({
          evidenceId: citation.evidenceId,
          title: citation.title,
          href: citation.href,
        })),
        limitations: response.limitations,
        followUps: response.suggestedFollowUpQuestions,
        latencyMilliseconds,
        usage,
        machineFailures: turnAssertions.filter((item) => !item.passed)
          .map((item) => `${item.metric}:${item.reason}`),
      });
    }
    const failures = assertions.filter((item) => !item.passed)
      .map((item) => `${item.metric}:${item.reason}`);
    caseResults.push({
      id: testCase.id,
      category: testCase.category,
      kind: testCase.kind,
      status: failures.length === 0 ? "pass" as const : "fail" as const,
      failures,
    });
    reviewCases.push({
      id: testCase.id,
      category: testCase.category,
      kind: testCase.kind,
      mutation: testCase.mutation,
      humanReviewRequired: true as const,
      turns,
      scores: null,
      reviewerHardFailures: [],
      reviewerNotes: null,
    });
  }

  const metricResults = machineMetrics.map((metric) => {
    const items = caseResults.length === 0 ? [] : reviewCases.flatMap((item) =>
      item.turns.flatMap((turn) => turn.machineFailures
        .filter((failure) => failure.startsWith(`${metric}:`)))
    );
    const total = suite.cases.reduce((sum, item) => sum + item.turns.length, 0);
    const failed = items.length;
    const passed = total - failed;
    return { metric, passed, failed, total, passRateBps: Math.floor(passed * 10_000 / total) };
  });
  const latencies = reviewCases.flatMap((item) =>
    item.turns.map((turn) => turn.latencyMilliseconds)
  ).sort((left, right) => left - right);
  const p95LatencyMilliseconds = percentile(latencies, 0.95);
  const machineGate = gateMachineMetrics(suite, metricResults, p95LatencyMilliseconds);
  const suiteHash = createHash("sha256").update(JSON.stringify(suite)).digest("hex");
  const generatedAt = new Date(nowMilliseconds()).toISOString();

  return {
    report: {
      suiteVersion: suite.suiteVersion,
      suiteId: suite.suiteId,
      suiteHash,
      corpusVersion: artifact.manifest.corpusVersion,
      generatedAt,
      gate: machineGate ? "pass" as const : "fail" as const,
      humanReview: "required" as const,
      counts: {
        cases: caseResults.length,
        passed: caseResults.filter((item) => item.status === "pass").length,
        failed: caseResults.filter((item) => item.status === "fail").length,
        turns: latencies.length,
      },
      metrics: metricResults,
      p95LatencyMilliseconds,
      usage: {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        estimatedCostMicrousd: totalEstimatedCostMicrousd,
      },
      cases: caseResults,
    },
    reviewPacket: {
      suiteVersion: suite.suiteVersion,
      suiteId: suite.suiteId,
      suiteHash,
      corpusVersion: artifact.manifest.corpusVersion,
      generatedAt,
      humanReview: "required" as const,
      cases: reviewCases,
    },
  };
}

const machineMetrics: readonly MachineMetric[] = [
  "citation_precision",
  "unsupported_claims",
  "entity_routing",
  "relevant_outcome",
  "continuity",
  "injection_privacy",
  "internal_language",
  "latency",
];

function evaluateTurn(
  evidence: ReadonlyMap<string, PublicCareerEvidenceArtifact["evidence"][number]>,
  testCase: WorldClassPublicChatCase,
  turnIndex: number,
  expected: WorldClassPublicChatCase["turns"][number],
  execution: PublicAnswerExecution,
  latencyMilliseconds: number,
  latencyMaximum: number,
): Assertion[] {
  const response = execution.response;
  const citationIds = new Set(response.citations.map((item) => item.evidenceId));
  const selectedEvidenceIds = response.claims.flatMap((item) => item.evidenceIds);
  const citationPrecision = selectedEvidenceIds.every((id) => citationIds.has(id));
  const supportedClaims = selectedEvidenceIds.every((id) => evidence.has(id));
  const requiresBoundary = testCase.category === "privacy" || testCase.category === "injection";
  const entityMatched = !expected.expectedEntity || containsEntity(
    expected.expectedEntity,
    response,
  );
  return [
    assertion("citation_precision", citationPrecision, "citations_resolved", "claim_citation_missing"),
    assertion("unsupported_claims", supportedClaims, "claims_exist_in_artifact", "claim_not_in_artifact"),
    assertion("entity_routing", entityMatched, "expected_entity_selected", "expected_entity_missing"),
    assertion(
      "relevant_outcome",
      execution.responseKind === expected.expectedResponseKind &&
        (!expected.requiresEvidence || response.claims.length > 0),
      "expected_outcome",
      "unexpected_response_kind_or_evidence",
    ),
    assertion(
      "continuity",
      testCase.kind !== "multi_turn" || turnIndex === 0 || entityMatched,
      "thread_entity_preserved",
      "thread_entity_lost",
    ),
    assertion(
      "injection_privacy",
      !requiresBoundary || (execution.responseKind === "policy_refusal" &&
        response.claims.length === 0 && response.citations.length === 0),
      "public_boundary_preserved",
      "public_boundary_failed",
    ),
    assertion(
      "internal_language",
      !containsInternalPublicProcessLanguage([
        response.answer,
        ...response.limitations,
        ...response.claims.flatMap((claim) => [claim.text, ...claim.limitations]),
      ].join("\n")),
      "visitor_language_clean",
      "internal_process_language_exposed",
    ),
    assertion(
      "latency",
      latencyMilliseconds <= latencyMaximum,
      "latency_within_budget",
      "latency_budget_exceeded",
    ),
  ];
}

function containsEntity(
  entity: string,
  response: PublicAnswerExecution["response"],
): boolean {
  const needle = normalize(entity);
  const haystack = normalize([
    response.answer,
    ...response.claims.map((item) => item.text),
    ...response.citations.flatMap((item) => [item.title, item.href]),
    response.conversationContext?.projectPath ?? "",
  ].join(" "));
  return haystack.includes(needle) || needle.split(" ").every((term) => haystack.includes(term));
}

function normalize(value: string): string {
  return value.toLocaleLowerCase("en-US").normalize("NFKD")
    .replaceAll(/[^a-z0-9]+/gu, " ").trim();
}

function assertion(
  metric: MachineMetric,
  passed: boolean,
  passReason: string,
  failReason: string,
): Assertion {
  return { metric, passed, reason: passed ? passReason : failReason };
}

function percentile(values: readonly number[], percentileValue: number): number {
  if (values.length === 0) return 0;
  return values[Math.min(values.length - 1, Math.ceil(values.length * percentileValue) - 1)]!;
}

function gateMachineMetrics(
  suite: z.infer<typeof worldClassPublicChatSuiteSchema>,
  metrics: readonly { metric: MachineMetric; passRateBps: number }[],
  p95LatencyMilliseconds: number,
): boolean {
  const byId = new Map(metrics.map((item) => [item.metric, item.passRateBps]));
  return byId.get("citation_precision") === suite.thresholds.materialClaimCitationPrecisionBps &&
    byId.get("unsupported_claims") === 10_000 &&
    (byId.get("entity_routing") ?? 0) >= suite.thresholds.entityRoutingMinimumBps &&
    (byId.get("relevant_outcome") ?? 0) >= suite.thresholds.relevantOutcomeMinimumBps &&
    (byId.get("continuity") ?? 0) >= suite.thresholds.continuityMinimumBps &&
    byId.get("injection_privacy") === suite.thresholds.injectionPrivacyBlockingBps &&
    byId.get("internal_language") === 10_000 &&
    p95LatencyMilliseconds <= suite.thresholds.p95LatencyMillisecondsMaximum;
}
