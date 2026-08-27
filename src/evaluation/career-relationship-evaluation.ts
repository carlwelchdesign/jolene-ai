import { createHash } from "node:crypto";

import { z } from "zod";

import {
  careerEntityKindSchema,
  careerMaturitySchema,
  careerRelationshipKindSchema,
  careerRecordStateSchema,
  careerSourceStateSchema,
  careerVisibilitySchema,
  evidenceReviewStateSchema,
  type CareerClaim,
  type CareerEvidenceScope,
  type CareerRelationship,
  type CareerSource,
} from "../domain/career-evidence.js";
import {
  isCareerEvidenceEligible,
  type CareerEmbeddingProvider,
  type CareerRetrievalEvidenceSource,
} from "../domain/career-retrieval.js";
import { SqliteCareerRetrievalIndex } from
  "../persistence/sqlite-career-retrieval-index.js";

const metricSchema = z.enum([
  "contract_validity",
  "lexical_baseline_coverage",
  "relational_recall_at_k",
  "relational_precision_at_k",
  "relational_no_regression",
  "relational_improvement",
]);

const thresholdSchema = z.object({
  minimumPassRateBps: z.number().int().min(0).max(10_000),
  blockingSeverity: z.literal("blocker"),
}).strict();

const sourceSchema = z.object({
  id: z.string().regex(/^benchmark:source:[a-z0-9][a-z0-9-]{1,60}$/),
  title: z.string().trim().min(1).max(160),
  tags: z.array(z.string().trim().min(1).max(60)).max(12),
  reviewState: evidenceReviewStateSchema,
  lastReviewedAt: z.string().datetime().nullable(),
  state: careerSourceStateSchema,
}).strict();

const claimSchema = z.object({
  id: z.string().regex(/^benchmark:claim:[a-z0-9][a-z0-9-]{1,60}$/),
  sourceId: sourceSchema.shape.id,
  logicalKey: z.string().regex(/^[a-z0-9][a-z0-9-]{1,60}$/),
  title: z.string().trim().min(1).max(160),
  proposition: z.string().trim().min(1).max(600),
  contribution: z.string().trim().min(1).max(400),
  maturity: careerMaturitySchema,
  visibility: careerVisibilitySchema,
  reviewState: evidenceReviewStateSchema,
  lastReviewedAt: z.string().datetime().nullable(),
  state: careerRecordStateSchema,
}).strict();

const relationshipSchema = z.object({
  id: z.string().regex(/^benchmark:relationship:[a-z0-9][a-z0-9-]{1,60}$/),
  sourceId: sourceSchema.shape.id,
  claimId: claimSchema.shape.id.nullable(),
  fromKind: careerEntityKindSchema,
  fromId: z.string().trim().min(1).max(120),
  relationship: careerRelationshipKindSchema,
  toKind: careerEntityKindSchema,
  toId: z.string().trim().min(1).max(120),
  state: z.enum(["active", "revoked"]),
}).strict();

const caseSchema = z.object({
  id: z.string().regex(/^benchmark:question:[a-z0-9][a-z0-9-]{1,60}$/),
  query: z.string().trim().min(2).max(300),
  expectedClaimIds: z.array(claimSchema.shape.id).min(1).max(8),
  limit: z.number().int().min(1).max(8),
  seedLimit: z.number().int().min(1).max(4),
  maxDepth: z.number().int().min(1).max(2),
  requiresImprovement: z.boolean(),
}).strict().refine((item) => item.seedLimit <= item.limit, {
  message: "The relationship seed limit cannot exceed the result limit.",
  path: ["seedLimit"],
});

export const careerRelationshipEvaluationSuiteSchema = z.object({
  suiteVersion: z.literal("1.0.0"),
  suiteId: z.string().regex(/^career-relationship:[a-z0-9][a-z0-9-]{2,80}$/),
  evaluatedAt: z.string().datetime(),
  scope: z.object({
    actorId: z.string().trim().min(1).max(120),
    workspaceId: z.string().trim().min(1).max(120),
  }).strict(),
  thresholds: z.record(metricSchema, thresholdSchema),
  sources: z.array(sourceSchema).min(1).max(40),
  claims: z.array(claimSchema).min(1).max(80),
  relationships: z.array(relationshipSchema).min(1).max(160),
  cases: z.array(caseSchema).min(1).max(40),
}).strict().superRefine((suite, context) => {
  checkUnique(suite.sources, "source", context);
  checkUnique(suite.claims, "claim", context);
  checkUnique(suite.relationships, "relationship", context);
  checkUnique(suite.cases, "question", context);

  const sourceIds = new Set(suite.sources.map(({ id }) => id));
  const claimIds = new Set(suite.claims.map(({ id }) => id));
  const claimsById = new Map(suite.claims.map((claim) => [claim.id, claim]));
  for (const claim of suite.claims) {
    if (!sourceIds.has(claim.sourceId)) {
      context.addIssue({ code: "custom", message: "A claim references an unknown source." });
    }
  }
  for (const relationship of suite.relationships) {
    if (!sourceIds.has(relationship.sourceId)) {
      context.addIssue({ code: "custom", message: "A relationship references an unknown source." });
    }
    if (relationship.claimId && !claimIds.has(relationship.claimId)) {
      context.addIssue({ code: "custom", message: "A relationship references an unknown claim." });
    }
    const claim = relationship.claimId
      ? claimsById.get(relationship.claimId)
      : null;
    if (claim && claim.sourceId !== relationship.sourceId) {
      context.addIssue({
        code: "custom",
        message: "A claim relationship must use the claim's evidence source.",
      });
    }
  }
  for (const item of suite.cases) {
    if (new Set(item.expectedClaimIds).size !== item.expectedClaimIds.length) {
      context.addIssue({ code: "custom", message: "Expected claim IDs must be unique." });
    }
    if (item.expectedClaimIds.some((id) => !claimIds.has(id))) {
      context.addIssue({ code: "custom", message: "A question references an unknown expected claim." });
    }
  }
});

export type CareerRelationshipEvaluationSuite = z.infer<
  typeof careerRelationshipEvaluationSuiteSchema
>;

interface Assertion {
  readonly metric: z.infer<typeof metricSchema>;
  readonly passed: boolean;
  readonly reason: string;
}

export interface CareerRelationshipEvaluationReport {
  readonly suiteVersion: "1.0.0";
  readonly suiteId: string;
  readonly suiteHash: string;
  readonly gate: "pass" | "fail";
  readonly counts: {
    readonly cases: number;
    readonly passed: number;
    readonly failed: number;
  };
  readonly summary: {
    readonly lexicalRecallBps: number;
    readonly relationalRecallBps: number;
    readonly relationalPrecisionBps: number;
    readonly recallImprovementBps: number;
  };
  readonly metrics: readonly {
    readonly id: z.infer<typeof metricSchema>;
    readonly passed: number;
    readonly total: number;
    readonly passRateBps: number;
    readonly minimumPassRateBps: number;
    readonly blockingSeverity: "blocker";
    readonly gate: "pass" | "fail";
  }[];
  readonly cases: readonly {
    readonly id: string;
    readonly status: "pass" | "fail";
    readonly failures: readonly string[];
  }[];
}

export async function evaluateCareerRelationshipSuite(
  input: unknown,
): Promise<CareerRelationshipEvaluationReport> {
  const suite = careerRelationshipEvaluationSuiteSchema.parse(input);
  const fixture = materializeFixture(suite);
  const evidence = new FixtureEvidenceSource(fixture.sources, fixture.claims);
  const index = new SqliteCareerRetrievalIndex(
    ":memory:",
    evidence,
    new LexicalOnlyEmbeddingProvider(),
    () => new Date(suite.evaluatedAt),
  );

  const caseResults: Array<{
    id: string;
    lexicalRecallBps: number;
    relationalRecallBps: number;
    relationalPrecisionBps: number;
    assertions: readonly Assertion[];
  }> = [];
  try {
    for (const item of suite.cases) {
      try {
        const lexical = await index.search(item.query, suite.scope, item.limit);
        const lexicalIds = lexical.results.map(({ citation }) => citation.claimId);
        const relationalIds = expandRelationshipBaseline({
          seedClaimIds: lexicalIds,
          seedLimit: item.seedLimit,
          eligibleClaims: fixture.eligibleClaimIds,
          relationships: fixture.relationships,
          maxDepth: item.maxDepth,
          limit: item.limit,
        });
        const lexicalRecall = recallBps(lexicalIds, item.expectedClaimIds);
        const relationalRecall = recallBps(relationalIds, item.expectedClaimIds);
        const relationalPrecision = precisionBps(relationalIds, item.expectedClaimIds);
        caseResults.push({
          id: item.id,
          lexicalRecallBps: lexicalRecall,
          relationalRecallBps: relationalRecall,
          relationalPrecisionBps: relationalPrecision,
          assertions: [
            assertion(
              "contract_validity",
              lexical.mode === "lexical_fallback",
              "lexical_baseline_mode_unexpected",
            ),
            assertion(
              "lexical_baseline_coverage",
              lexicalRecall > 0,
              "lexical_baseline_missed_all_expected_claims",
            ),
            assertion(
              "relational_recall_at_k",
              relationalRecall === 10_000,
              "relational_recall_incomplete",
            ),
            assertion(
              "relational_precision_at_k",
              relationalPrecision === 10_000,
              "relational_precision_incomplete",
            ),
            assertion(
              "relational_no_regression",
              relationalRecall >= lexicalRecall,
              "relational_recall_regressed",
            ),
            ...(item.requiresImprovement
              ? [assertion(
                  "relational_improvement",
                  relationalRecall > lexicalRecall,
                  "relational_recall_did_not_improve",
                )]
              : []),
          ],
        });
      } catch {
        caseResults.push({
          id: item.id,
          lexicalRecallBps: 0,
          relationalRecallBps: 0,
          relationalPrecisionBps: 0,
          assertions: metricSchema.options.map((metric) =>
            assertion(metric, false, "benchmark_execution_failed")
          ),
        });
      }
    }
  } finally {
    index.close();
  }

  const metrics = metricSchema.options.map((id) => {
    const assertions = caseResults.flatMap((item) =>
      item.assertions.filter((candidate) => candidate.metric === id)
    );
    const passed = assertions.filter((candidate) => candidate.passed).length;
    const total = assertions.length;
    const passRateBps = total === 0 ? 0 : Math.floor(passed * 10_000 / total);
    const threshold = suite.thresholds[id];
    return {
      id,
      passed,
      total,
      passRateBps,
      minimumPassRateBps: threshold.minimumPassRateBps,
      blockingSeverity: threshold.blockingSeverity,
      gate: total > 0 && passRateBps >= threshold.minimumPassRateBps
        ? "pass" as const
        : "fail" as const,
    };
  });
  const cases = caseResults.map((item) => {
    const failures = item.assertions
      .filter((candidate) => !candidate.passed)
      .map((candidate) => `${candidate.metric}:${candidate.reason}`);
    return {
      id: item.id,
      status: failures.length === 0 ? "pass" as const : "fail" as const,
      failures,
    };
  });
  const passed = cases.filter(({ status }) => status === "pass").length;
  const lexicalRecallBps = averageBps(
    caseResults.map((item) => item.lexicalRecallBps),
  );
  const relationalRecallBps = averageBps(
    caseResults.map((item) => item.relationalRecallBps),
  );
  return {
    suiteVersion: suite.suiteVersion,
    suiteId: suite.suiteId,
    suiteHash: createHash("sha256").update(JSON.stringify(suite)).digest("hex"),
    gate: metrics.every((metric) => metric.gate === "pass") &&
        cases.every((item) => item.status === "pass")
      ? "pass"
      : "fail",
    counts: { cases: cases.length, passed, failed: cases.length - passed },
    summary: {
      lexicalRecallBps,
      relationalRecallBps,
      relationalPrecisionBps: averageBps(
        caseResults.map((item) => item.relationalPrecisionBps),
      ),
      recallImprovementBps: relationalRecallBps - lexicalRecallBps,
    },
    metrics,
    cases,
  };
}

function expandRelationshipBaseline(input: {
  readonly seedClaimIds: readonly string[];
  readonly seedLimit: number;
  readonly eligibleClaims: ReadonlySet<string>;
  readonly relationships: readonly CareerRelationship[];
  readonly maxDepth: number;
  readonly limit: number;
}): readonly string[] {
  const claimEntities = new Map<string, Set<string>>();
  const entityClaims = new Map<string, Set<string>>();
  for (const relationship of input.relationships) {
    if (
      relationship.state !== "active" ||
      !relationship.claimId ||
      !input.eligibleClaims.has(relationship.claimId)
    ) continue;
    const entities = [
      `${relationship.fromKind}:${relationship.fromId}`,
      `${relationship.toKind}:${relationship.toId}`,
    ];
    for (const entity of entities) {
      addToSetMap(claimEntities, relationship.claimId, entity);
      addToSetMap(entityClaims, entity, relationship.claimId);
    }
  }

  const lexical = Array.from(new Set(input.seedClaimIds))
    .filter((id) => input.eligibleClaims.has(id));
  const ranked = lexical.slice(0, input.seedLimit);
  const visited = new Set(ranked);
  let frontier = [...ranked];
  for (let depth = 1; depth <= input.maxDepth && frontier.length > 0; depth += 1) {
    const scores = new Map<string, number>();
    for (const claimId of frontier) {
      for (const entity of claimEntities.get(claimId) ?? []) {
        for (const candidate of entityClaims.get(entity) ?? []) {
          if (visited.has(candidate)) continue;
          scores.set(candidate, (scores.get(candidate) ?? 0) + 1);
        }
      }
    }
    frontier = [...scores.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([id]) => id);
    frontier.forEach((id) => visited.add(id));
    ranked.push(...frontier);
  }
  ranked.push(...lexical.filter((id) => !visited.has(id)));
  return ranked.slice(0, input.limit);
}

function materializeFixture(suite: CareerRelationshipEvaluationSuite) {
  const scope = suite.scope as CareerEvidenceScope;
  const createdAt = suite.evaluatedAt;
  const sources: CareerSource[] = suite.sources.map((source) => ({
    ...scope,
    id: source.id,
    sourceType: "confirmed_fact",
    title: source.title,
    provenanceRef: `benchmark/${source.id}`,
    provenanceUri: null,
    sourceHash: createHash("sha256").update(source.id).digest("hex"),
    capturedAt: createdAt,
    metadata: {
      relativePath: null,
      tags: source.tags,
      aliases: [],
      wikiLinks: [],
      markdownLinks: [],
      headings: [],
      frontmatterKeys: [],
      documentDate: null,
    },
    reviewState: source.reviewState,
    reviewedBy: source.reviewState === "approved" ? "benchmark-owner" : null,
    lastReviewedAt: source.lastReviewedAt,
    state: source.state,
    createdAt,
    updatedAt: createdAt,
  }));
  const claims: CareerClaim[] = suite.claims.map((claim) => ({
    ...scope,
    ...claim,
    reviewedBy: claim.reviewState === "approved" ? "benchmark-owner" : null,
    supersedesClaimId: null,
    createdAt,
    updatedAt: createdAt,
  }));
  const relationships: CareerRelationship[] = suite.relationships.map((item) => ({
    ...scope,
    ...item,
    createdAt,
    updatedAt: createdAt,
  }));
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const eligibleClaimIds = new Set(claims.filter((claim) => {
    const source = sourceById.get(claim.sourceId);
    return source
      ? isCareerEvidenceEligible(source, claim, new Date(suite.evaluatedAt))
      : false;
  }).map(({ id }) => id));
  return { sources, claims, relationships, eligibleClaimIds };
}

class FixtureEvidenceSource implements CareerRetrievalEvidenceSource {
  constructor(
    private readonly sources: readonly CareerSource[],
    private readonly claims: readonly CareerClaim[],
  ) {}

  listSources(scope: CareerEvidenceScope): readonly CareerSource[] {
    return this.sources.filter((item) => inScope(item, scope));
  }

  listClaims(scope: CareerEvidenceScope): readonly CareerClaim[] {
    return this.claims.filter((item) => inScope(item, scope));
  }
}

class LexicalOnlyEmbeddingProvider implements CareerEmbeddingProvider {
  readonly existingEmbeddingPolicy = "purge" as const;

  async embed(): Promise<null> {
    return null;
  }
}

function inScope(
  item: { readonly actorId: string; readonly workspaceId: string },
  scope: CareerEvidenceScope,
): boolean {
  return item.actorId === scope.actorId && item.workspaceId === scope.workspaceId;
}

function recallBps(actual: readonly string[], expected: readonly string[]): number {
  const actualIds = new Set(actual);
  const hits = expected.filter((id) => actualIds.has(id)).length;
  return Math.floor(hits * 10_000 / expected.length);
}

function precisionBps(actual: readonly string[], expected: readonly string[]): number {
  if (actual.length === 0) return 0;
  const expectedIds = new Set(expected);
  const hits = actual.filter((id) => expectedIds.has(id)).length;
  return Math.floor(hits * 10_000 / actual.length);
}

function averageBps(values: readonly number[]): number {
  return values.length === 0
    ? 0
    : Math.floor(values.reduce((total, value) => total + value, 0) / values.length);
}

function assertion(
  metric: Assertion["metric"],
  passed: boolean,
  reason: string,
): Assertion {
  return { metric, passed, reason };
}

function addToSetMap(
  map: Map<string, Set<string>>,
  key: string,
  value: string,
): void {
  const values = map.get(key) ?? new Set<string>();
  values.add(value);
  map.set(key, values);
}

function checkUnique(
  items: readonly { readonly id: string }[],
  label: string,
  context: z.RefinementCtx,
): void {
  if (new Set(items.map(({ id }) => id)).size !== items.length) {
    context.addIssue({ code: "custom", message: `Benchmark ${label} IDs must be unique.` });
  }
}
