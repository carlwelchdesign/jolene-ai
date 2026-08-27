import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import {
  assessCareerRelationshipTopology,
  careerRelationshipTopologySnapshotSchema,
  type CareerRelationshipTopologySnapshot,
  SqliteCareerRelationshipTopologySource,
} from "../src/evaluation/career-relationship-topology.js";

const fixedNow = new Date("2026-08-27T06:00:00.000Z");
const scope = { actorId: "carl", workspaceId: "professional" } as const;

describe("career relationship topology audit", () => {
  it("passes a bounded topology with direct coverage and two-hop candidates", () => {
    const report = assessCareerRelationshipTopology(createReadySnapshot(), fixedNow);

    expect(report).toMatchObject({
      gate: "pass",
      readiness: "ready_for_private_question_review",
      recommendation: "prepare_owner_reviewed_private_benchmark",
      counts: {
        eligibleSources: 10,
        eligibleClaims: 10,
        eligibleRelationships: 20,
        claimLinkedRelationships: 15,
        sourceLevelRelationships: 5,
        directLinkedClaims: 3,
        effectiveRelatedClaims: 8,
        entities: 18,
        sharedEntities: 10,
        oneHopPairs: 7,
        twoHopPairs: 21,
        connectedComponents: 3,
        largestComponent: 8,
        isolatedClaims: 2,
      },
      coverage: {
        directClaimCoverageBps: 3_000,
        effectiveRelationshipCoverageBps: 8_000,
        largestComponentBps: 8_000,
      },
      gaps: { additionalDirectLinkedClaimsRequired: 0 },
      failures: [],
    });
    expect(report.metrics.every(({ gate }) => gate === "pass")).toBe(true);
  });

  it("requires claim enrichment when source inheritance masks sparse direct links", () => {
    const snapshot = createReadySnapshot();
    snapshot.relationships = snapshot.relationships.map((relationship) =>
      relationship.claimId === "claim-2" || relationship.claimId === "claim-3"
        ? { ...relationship, claimId: null }
        : relationship
    );

    const report = assessCareerRelationshipTopology(snapshot, fixedNow);

    expect(report).toMatchObject({
      gate: "fail",
      readiness: "claim_relationship_enrichment_required",
      recommendation: "enrich_claim_relationships_before_private_benchmark",
      coverage: {
        directClaimCoverageBps: 1_000,
        effectiveRelationshipCoverageBps: 8_000,
      },
      gaps: { additionalDirectLinkedClaimsRequired: 2 },
      failures: ["direct_claim_coverage_minimum_threshold_failed"],
    });
  });

  it("excludes stale, unreviewed, revoked, and cross-source claim links", () => {
    const snapshot = createReadySnapshot();
    snapshot.sources[7] = {
      ...snapshot.sources[7]!,
      reviewState: "needs_review",
      lastReviewedAt: null,
    };
    snapshot.claims[8] = { ...snapshot.claims[8]!, state: "revoked" };
    snapshot.relationships.push({
      ...relationship("cross-source", "source-1", "claim-2", "cross-source"),
    });

    const report = assessCareerRelationshipTopology(snapshot, fixedNow);

    expect(report.counts.eligibleSources).toBe(9);
    expect(report.counts.eligibleClaims).toBe(8);
    expect(report.counts.eligibleRelationships).toBe(19);
    expect(report.coverage.directClaimCoverageBps).toBe(3_750);
    expect(report.corpusFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(report)).not.toContain("claim-2");
    expect(JSON.stringify(report)).not.toContain("cross-source");
  });

  it("is deterministic and fails closed for duplicate IDs and scope drift", () => {
    const snapshot = createReadySnapshot();
    expect(assessCareerRelationshipTopology(snapshot, fixedNow)).toEqual(
      assessCareerRelationshipTopology(structuredClone(snapshot), fixedNow),
    );

    const duplicate = createReadySnapshot();
    duplicate.claims[1] = { ...duplicate.claims[1]!, id: duplicate.claims[0]!.id };
    expect(() => careerRelationshipTopologySnapshotSchema.parse(duplicate))
      .toThrow(/claim IDs must be unique/i);

    const scopeDrift = createReadySnapshot();
    scopeDrift.relationships[0] = {
      ...scopeDrift.relationships[0]!,
      workspaceId: "other",
    };
    expect(() => careerRelationshipTopologySnapshotSchema.parse(scopeDrift))
      .toThrow(/relationship scope must match/i);

    const dangling = createReadySnapshot();
    dangling.relationships[0] = {
      ...dangling.relationships[0]!,
      claimId: "missing-claim",
    };
    expect(() => careerRelationshipTopologySnapshotSchema.parse(dangling))
      .toThrow(/unknown claim/i);

    expect(assessCareerRelationshipTopology({
      scope,
      sources: [],
      claims: [],
      relationships: [],
    }, fixedNow)).toMatchObject({
      gate: "fail",
      readiness: "topology_insufficient",
      recommendation: "review_relationship_ingestion_before_private_benchmark",
    });
  });

  it("reads only topology columns from SQLite and exits nonzero for a sparse corpus", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "jolene-topology-"));
    const databasePath = path.join(directory, "career.sqlite");
    try {
      createSparseDatabase(databasePath);
      const source = new SqliteCareerRelationshipTopologySource(databasePath);
      expect(source.snapshot(scope)).toMatchObject({
        scope,
        sources: [{ id: "private-source-marker" }],
        claims: [{ id: "private-claim-marker" }],
        relationships: [{ id: "private-relationship-marker" }],
      });
      source.close();

      const result = spawnSync(
        path.resolve("node_modules/.bin/tsx"),
        ["src/career-topology.ts"],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          env: { ...process.env, JOLENE_DATABASE_PATH: databasePath },
        },
      );
      expect(result.status).toBe(1);
      expect(JSON.parse(result.stdout)).toMatchObject({
        gate: "fail",
        readiness: "topology_insufficient",
      });
      expect(result.stderr).toBe("");
      expect(result.stdout).not.toContain("private-source-marker");
      expect(result.stdout).not.toContain("private-claim-marker");
      expect(result.stdout).not.toContain("private-relationship-marker");

      const moduleText = readFileSync(
        path.resolve("src/evaluation/career-relationship-topology.ts"),
        "utf8",
      );
      for (const forbiddenColumn of [
        "proposition", "contribution", "provenance_ref", "provenance_uri",
        "metadata_json", "relative_path",
      ]) {
        expect(moduleText).not.toContain(forbiddenColumn);
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

function createReadySnapshot(): CareerRelationshipTopologySnapshot {
  const sources = Array.from({ length: 10 }, (_, index) => source(index + 1));
  const claims = Array.from({ length: 10 }, (_, index) => claim(index + 1));
  const relationships = [] as ReturnType<typeof relationship>[];

  for (let entity = 1; entity <= 10; entity += 1) {
    relationships.push(relationship(
      `center-${entity}`,
      "source-1",
      "claim-1",
      `shared-${entity}`,
    ));
  }
  for (const entity of [1, 8, 9, 10]) {
    relationships.push(relationship(
      `leaf-2-${entity}`,
      "source-2",
      "claim-2",
      `shared-${entity}`,
    ));
  }
  relationships.push(relationship("leaf-3", "source-3", "claim-3", "shared-2"));
  for (let leaf = 4; leaf <= 8; leaf += 1) {
    relationships.push(relationship(
      `leaf-${leaf}`,
      `source-${leaf}`,
      null,
      `shared-${leaf - 1}`,
    ));
  }
  return { scope, sources, claims, relationships };
}

function source(
  index: number,
): CareerRelationshipTopologySnapshot["sources"][number] {
  return {
    ...scope,
    id: `source-${index}`,
    state: "active" as const,
    reviewState: "approved" as const,
    lastReviewedAt: "2026-08-20T12:00:00.000Z",
  };
}

function claim(
  index: number,
): CareerRelationshipTopologySnapshot["claims"][number] {
  return {
    ...scope,
    id: `claim-${index}`,
    sourceId: `source-${index}`,
    state: "active" as const,
    reviewState: "approved" as const,
    visibility: "internal_approved" as const,
    lastReviewedAt: "2026-08-20T12:00:00.000Z",
  };
}

function relationship(
  id: string,
  sourceId: string,
  claimId: string | null,
  entity: string,
): CareerRelationshipTopologySnapshot["relationships"][number] {
  return {
    ...scope,
    id: `relationship-${id}`,
    sourceId,
    claimId,
    fromKind: "project" as const,
    fromId: sourceId,
    relationship: "demonstrates" as const,
    toKind: "capability" as const,
    toId: entity,
    state: "active" as const,
  };
}

function createSparseDatabase(databasePath: string): void {
  const database = new Database(databasePath);
  database.exec(`
    CREATE TABLE career_sources (
      id TEXT PRIMARY KEY, actor_id TEXT, workspace_id TEXT, state TEXT,
      review_state TEXT, last_reviewed_at TEXT
    );
    CREATE TABLE career_claims (
      id TEXT PRIMARY KEY, actor_id TEXT, workspace_id TEXT, source_id TEXT,
      state TEXT, review_state TEXT, visibility TEXT, last_reviewed_at TEXT
    );
    CREATE TABLE career_relationships (
      id TEXT PRIMARY KEY, actor_id TEXT, workspace_id TEXT, source_id TEXT,
      claim_id TEXT, from_kind TEXT, from_id TEXT, relationship TEXT,
      to_kind TEXT, to_id TEXT, state TEXT
    );
  `);
  database.prepare(
    "INSERT INTO career_sources VALUES (?, ?, ?, ?, ?, ?)",
  ).run(
    "private-source-marker", "carl", "professional", "active", "approved",
    "2026-08-20T12:00:00.000Z",
  );
  database.prepare(
    "INSERT INTO career_claims VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    "private-claim-marker", "carl", "professional", "private-source-marker",
    "active", "approved", "internal_approved", "2026-08-20T12:00:00.000Z",
  );
  database.prepare(
    "INSERT INTO career_relationships VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    "private-relationship-marker", "carl", "professional", "private-source-marker",
    "private-claim-marker", "project", "private-project-marker", "demonstrates",
    "capability", "private-capability-marker", "active",
  );
  database.close();
}
