import { createHash } from "node:crypto";
import path from "node:path";

import Database from "better-sqlite3";
import { z } from "zod";

import {
  careerEntityKindSchema,
  careerRelationshipKindSchema,
  careerRecordStateSchema,
  careerSourceStateSchema,
  careerVisibilitySchema,
  evidenceReviewStateSchema,
} from "../domain/career-evidence.js";
import {
  isCareerClaimEligible,
  isCareerSourceEligible,
} from "../domain/career-retrieval.js";

const scopeSchema = z.object({
  actorId: z.string().trim().min(1).max(120),
  workspaceId: z.string().trim().min(1).max(120),
}).strict();

const topologySourceSchema = scopeSchema.extend({
  id: z.string().trim().min(1).max(240),
  state: careerSourceStateSchema,
  reviewState: evidenceReviewStateSchema,
  lastReviewedAt: z.string().datetime().nullable(),
}).strict();

const topologyClaimSchema = scopeSchema.extend({
  id: z.string().trim().min(1).max(240),
  sourceId: z.string().trim().min(1).max(240),
  state: careerRecordStateSchema,
  reviewState: evidenceReviewStateSchema,
  visibility: careerVisibilitySchema,
  lastReviewedAt: z.string().datetime().nullable(),
}).strict();

const topologyRelationshipSchema = scopeSchema.extend({
  id: z.string().trim().min(1).max(240),
  sourceId: z.string().trim().min(1).max(240),
  claimId: z.string().trim().min(1).max(240).nullable(),
  fromKind: careerEntityKindSchema,
  fromId: z.string().trim().min(1).max(240),
  relationship: careerRelationshipKindSchema,
  toKind: careerEntityKindSchema,
  toId: z.string().trim().min(1).max(240),
  state: z.enum(["active", "revoked"]),
}).strict();

export const careerRelationshipTopologySnapshotSchema = z.object({
  scope: scopeSchema,
  sources: z.array(topologySourceSchema).max(1_000),
  claims: z.array(topologyClaimSchema).max(1_000),
  relationships: z.array(topologyRelationshipSchema).max(10_000),
}).strict().superRefine((snapshot, context) => {
  for (const [label, records] of [
    ["source", snapshot.sources],
    ["claim", snapshot.claims],
    ["relationship", snapshot.relationships],
  ] as const) {
    const ids = records.map(({ id }) => id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: "custom", message: `Topology ${label} IDs must be unique.` });
    }
    if (records.some((record) =>
      record.actorId !== snapshot.scope.actorId ||
      record.workspaceId !== snapshot.scope.workspaceId
    )) {
      context.addIssue({ code: "custom", message: `Topology ${label} scope must match.` });
    }
  }
  const sourceIds = new Set(snapshot.sources.map(({ id }) => id));
  const claimIds = new Set(snapshot.claims.map(({ id }) => id));
  if (snapshot.claims.some((claim) => !sourceIds.has(claim.sourceId))) {
    context.addIssue({ code: "custom", message: "A topology claim references an unknown source." });
  }
  if (snapshot.relationships.some((relationship) =>
    !sourceIds.has(relationship.sourceId)
  )) {
    context.addIssue({
      code: "custom",
      message: "A topology relationship references an unknown source.",
    });
  }
  if (snapshot.relationships.some((relationship) =>
    relationship.claimId !== null && !claimIds.has(relationship.claimId)
  )) {
    context.addIssue({
      code: "custom",
      message: "A topology relationship references an unknown claim.",
    });
  }
});

export type CareerRelationshipTopologySnapshot = z.infer<
  typeof careerRelationshipTopologySnapshotSchema
>;

export const CAREER_RELATIONSHIP_TOPOLOGY_POLICY = Object.freeze({
  minimumDirectClaimCoverageBps: 2_500,
  minimumEffectiveCoverageBps: 8_000,
  minimumSharedEntityCount: 10,
  minimumTwoHopPairCount: 20,
  maximumLargestComponentBps: 9_000,
});

export interface CareerRelationshipTopologyReport {
  readonly schemaVersion: "jolene.career-relationship-topology-report.v1";
  readonly evaluatedAt: string;
  readonly corpusFingerprint: string;
  readonly gate: "pass" | "fail";
  readonly readiness:
    | "ready_for_private_question_review"
    | "claim_relationship_enrichment_required"
    | "topology_insufficient";
  readonly recommendation:
    | "prepare_owner_reviewed_private_benchmark"
    | "enrich_claim_relationships_before_private_benchmark"
    | "review_relationship_ingestion_before_private_benchmark";
  readonly counts: {
    readonly eligibleSources: number;
    readonly eligibleClaims: number;
    readonly eligibleRelationships: number;
    readonly claimLinkedRelationships: number;
    readonly sourceLevelRelationships: number;
    readonly directLinkedClaims: number;
    readonly effectiveRelatedClaims: number;
    readonly entities: number;
    readonly sharedEntities: number;
    readonly oneHopPairs: number;
    readonly twoHopPairs: number;
    readonly connectedComponents: number;
    readonly largestComponent: number;
    readonly isolatedClaims: number;
  };
  readonly coverage: {
    readonly directClaimCoverageBps: number;
    readonly effectiveRelationshipCoverageBps: number;
    readonly largestComponentBps: number;
  };
  readonly gaps: {
    readonly additionalDirectLinkedClaimsRequired: number;
  };
  readonly policy: typeof CAREER_RELATIONSHIP_TOPOLOGY_POLICY;
  readonly metrics: readonly {
    readonly id: string;
    readonly value: number;
    readonly comparator: "minimum" | "maximum";
    readonly threshold: number;
    readonly gate: "pass" | "fail";
  }[];
  readonly failures: readonly string[];
}

export function assessCareerRelationshipTopology(
  input: unknown,
  now: Date = new Date(),
): CareerRelationshipTopologyReport {
  const snapshot = careerRelationshipTopologySnapshotSchema.parse(input);
  if (Number.isNaN(now.getTime())) throw new RangeError("Topology evaluation time is invalid.");
  const eligibleSources = new Map(snapshot.sources
    .filter((source) => isCareerSourceEligible(source, now))
    .map((source) => [source.id, source]));
  const eligibleClaims = new Map(snapshot.claims.filter((claim) => {
    return eligibleSources.has(claim.sourceId) && isCareerClaimEligible(claim, now);
  }).map((claim) => [claim.id, claim]));
  const claimsBySource = new Map<string, string[]>();
  for (const claim of eligibleClaims.values()) {
    const claims = claimsBySource.get(claim.sourceId) ?? [];
    claims.push(claim.id);
    claimsBySource.set(claim.sourceId, claims);
  }

  const claimEntities = new Map<string, Set<string>>();
  const entityClaims = new Map<string, Set<string>>();
  const directLinkedClaims = new Set<string>();
  let eligibleRelationshipCount = 0;
  let claimLinkedRelationshipCount = 0;
  let sourceLevelRelationshipCount = 0;
  for (const relationship of snapshot.relationships) {
    if (relationship.state !== "active" || !eligibleSources.has(relationship.sourceId)) {
      continue;
    }
    const attachedClaimIds = relationship.claimId
      ? eligibleClaims.has(relationship.claimId) &&
          eligibleClaims.get(relationship.claimId)?.sourceId === relationship.sourceId
        ? [relationship.claimId]
        : []
      : claimsBySource.get(relationship.sourceId) ?? [];
    if (attachedClaimIds.length === 0) continue;
    eligibleRelationshipCount += 1;
    if (relationship.claimId) {
      claimLinkedRelationshipCount += 1;
      directLinkedClaims.add(relationship.claimId);
    } else {
      sourceLevelRelationshipCount += 1;
    }
    const entities = [
      `${relationship.fromKind}:${relationship.fromId}`,
      `${relationship.toKind}:${relationship.toId}`,
    ];
    for (const claimId of attachedClaimIds) {
      for (const entity of entities) {
        addToSetMap(claimEntities, claimId, entity);
        addToSetMap(entityClaims, entity, claimId);
      }
    }
  }

  const adjacency = new Map(
    [...eligibleClaims.keys()].map((claimId) => [claimId, new Set<string>()]),
  );
  for (const claimIds of entityClaims.values()) {
    const sorted = [...claimIds].sort();
    for (let left = 0; left < sorted.length; left += 1) {
      for (let right = left + 1; right < sorted.length; right += 1) {
        const leftId = sorted[left]!;
        const rightId = sorted[right]!;
        adjacency.get(leftId)?.add(rightId);
        adjacency.get(rightId)?.add(leftId);
      }
    }
  }
  const oneHopPairs = countOneHopPairs(adjacency);
  const twoHopPairs = countTwoHopPairs(adjacency);
  const componentSizes = connectedComponentSizes(adjacency);
  const eligibleClaimCount = eligibleClaims.size;
  const largestComponent = componentSizes[0] ?? 0;
  const counts = {
    eligibleSources: eligibleSources.size,
    eligibleClaims: eligibleClaimCount,
    eligibleRelationships: eligibleRelationshipCount,
    claimLinkedRelationships: claimLinkedRelationshipCount,
    sourceLevelRelationships: sourceLevelRelationshipCount,
    directLinkedClaims: directLinkedClaims.size,
    effectiveRelatedClaims: claimEntities.size,
    entities: entityClaims.size,
    sharedEntities: [...entityClaims.values()].filter((claims) => claims.size > 1).length,
    oneHopPairs,
    twoHopPairs,
    connectedComponents: componentSizes.length,
    largestComponent,
    isolatedClaims: componentSizes.filter((size) => size === 1).length,
  };
  const coverage = {
    directClaimCoverageBps: ratioBps(directLinkedClaims.size, eligibleClaimCount),
    effectiveRelationshipCoverageBps: ratioBps(claimEntities.size, eligibleClaimCount),
    largestComponentBps: ratioBps(largestComponent, eligibleClaimCount),
  };
  const policy = CAREER_RELATIONSHIP_TOPOLOGY_POLICY;
  const minimumDirectLinkedClaims = Math.ceil(
    eligibleClaimCount * policy.minimumDirectClaimCoverageBps / 10_000,
  );
  const metrics = [
    minimumMetric(
      "direct_claim_coverage",
      coverage.directClaimCoverageBps,
      policy.minimumDirectClaimCoverageBps,
    ),
    minimumMetric(
      "effective_relationship_coverage",
      coverage.effectiveRelationshipCoverageBps,
      policy.minimumEffectiveCoverageBps,
    ),
    minimumMetric("shared_entity_pool", counts.sharedEntities, policy.minimumSharedEntityCount),
    minimumMetric("two_hop_candidate_pool", counts.twoHopPairs, policy.minimumTwoHopPairCount),
    maximumMetric(
      "largest_component_concentration",
      coverage.largestComponentBps,
      policy.maximumLargestComponentBps,
    ),
  ];
  const failures = metrics
    .filter((metric) => metric.gate === "fail")
    .map((metric) => `${metric.id}_${metric.comparator}_threshold_failed`);
  const gate = failures.length === 0 ? "pass" as const : "fail" as const;
  const enrichmentRequired = eligibleClaimCount > 0 && metrics[0]?.gate === "fail";
  return {
    schemaVersion: "jolene.career-relationship-topology-report.v1",
    evaluatedAt: now.toISOString(),
    corpusFingerprint: fingerprint(snapshot),
    gate,
    readiness: gate === "pass"
      ? "ready_for_private_question_review"
      : enrichmentRequired
        ? "claim_relationship_enrichment_required"
        : "topology_insufficient",
    recommendation: gate === "pass"
      ? "prepare_owner_reviewed_private_benchmark"
      : enrichmentRequired
        ? "enrich_claim_relationships_before_private_benchmark"
        : "review_relationship_ingestion_before_private_benchmark",
    counts,
    coverage,
    gaps: {
      additionalDirectLinkedClaimsRequired: Math.max(
        0,
        minimumDirectLinkedClaims - directLinkedClaims.size,
      ),
    },
    policy,
    metrics,
    failures,
  };
}

export class SqliteCareerRelationshipTopologySource {
  readonly #database: Database.Database;

  constructor(databasePath: string) {
    this.#database = new Database(path.resolve(databasePath), {
      readonly: true,
      fileMustExist: true,
    });
  }

  snapshot(input: unknown): CareerRelationshipTopologySnapshot {
    const scope = scopeSchema.parse(input);
    const sources = this.#database.prepare(
      `SELECT id, actor_id AS actorId, workspace_id AS workspaceId,
              state, review_state AS reviewState,
              last_reviewed_at AS lastReviewedAt
       FROM career_sources
       WHERE actor_id = ? AND workspace_id = ?
       ORDER BY id ASC`,
    ).all(scope.actorId, scope.workspaceId);
    const claims = this.#database.prepare(
      `SELECT id, actor_id AS actorId, workspace_id AS workspaceId,
              source_id AS sourceId, state, review_state AS reviewState,
              visibility, last_reviewed_at AS lastReviewedAt
       FROM career_claims
       WHERE actor_id = ? AND workspace_id = ?
       ORDER BY id ASC`,
    ).all(scope.actorId, scope.workspaceId);
    const relationships = this.#database.prepare(
      `SELECT id, actor_id AS actorId, workspace_id AS workspaceId,
              source_id AS sourceId, claim_id AS claimId,
              from_kind AS fromKind, from_id AS fromId,
              relationship, to_kind AS toKind, to_id AS toId, state
       FROM career_relationships
       WHERE actor_id = ? AND workspace_id = ?
       ORDER BY id ASC`,
    ).all(scope.actorId, scope.workspaceId);
    return careerRelationshipTopologySnapshotSchema.parse({
      scope,
      sources,
      claims,
      relationships,
    });
  }

  close(): void {
    this.#database.close();
  }
}

function fingerprint(snapshot: CareerRelationshipTopologySnapshot): string {
  return createHash("sha256").update(JSON.stringify({
    scope: snapshot.scope,
    sources: [...snapshot.sources].sort(byId),
    claims: [...snapshot.claims].sort(byId),
    relationships: [...snapshot.relationships].sort(byId),
  })).digest("hex");
}

function countOneHopPairs(adjacency: ReadonlyMap<string, ReadonlySet<string>>): number {
  let count = 0;
  for (const [claimId, neighbors] of adjacency) {
    count += [...neighbors].filter((neighbor) => claimId < neighbor).length;
  }
  return count;
}

function countTwoHopPairs(adjacency: ReadonlyMap<string, ReadonlySet<string>>): number {
  const pairs = new Set<string>();
  for (const [start, neighbors] of adjacency) {
    for (const middle of neighbors) {
      for (const end of adjacency.get(middle) ?? []) {
        if (start === end || neighbors.has(end)) continue;
        pairs.add([start, end].sort().join("\u0000"));
      }
    }
  }
  return pairs.size;
}

function connectedComponentSizes(
  adjacency: ReadonlyMap<string, ReadonlySet<string>>,
): readonly number[] {
  const visited = new Set<string>();
  const sizes: number[] = [];
  for (const start of adjacency.keys()) {
    if (visited.has(start)) continue;
    const pending = [start];
    visited.add(start);
    let size = 0;
    while (pending.length > 0) {
      const claimId = pending.shift()!;
      size += 1;
      for (const neighbor of adjacency.get(claimId) ?? []) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        pending.push(neighbor);
      }
    }
    sizes.push(size);
  }
  return sizes.sort((left, right) => right - left);
}

function ratioBps(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Math.floor(numerator * 10_000 / denominator);
}

function minimumMetric(id: string, value: number, threshold: number) {
  return {
    id,
    value,
    comparator: "minimum" as const,
    threshold,
    gate: value >= threshold ? "pass" as const : "fail" as const,
  };
}

function maximumMetric(id: string, value: number, threshold: number) {
  return {
    id,
    value,
    comparator: "maximum" as const,
    threshold,
    gate: value <= threshold ? "pass" as const : "fail" as const,
  };
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

function byId(
  left: { readonly id: string },
  right: { readonly id: string },
): number {
  return left.id.localeCompare(right.id);
}
