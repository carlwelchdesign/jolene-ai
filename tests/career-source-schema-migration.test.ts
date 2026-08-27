import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { SqliteCareerEvidenceStore } from "../src/persistence/sqlite-career-evidence-store.js";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("career source schema migration", () => {
  it("preserves existing sources while adding career notes, metadata, and missing state", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "jolene-career-schema-"));
    tempDirectories.push(directory);
    const databasePath = path.join(directory, "jolene.sqlite");
    createLegacyDatabase(databasePath);

    const store = new SqliteCareerEvidenceStore(databasePath);
    let conflictId = "";
    let candidateId = "";
    try {
      expect(store.listSources(scope)[0]).toMatchObject({
        id: "portfolio:project:sample",
        metadata: {
          relativePath: null,
          tags: [],
        },
      });
      const note = store.upsertSource({
        id: "obsidian:career:sample",
        ...scope,
        sourceType: "career_note",
        title: "Career note",
        provenanceRef: "obsidian:01 Career & Job Search/Career.md",
        provenanceUri: null,
        sourceHash: "b".repeat(64),
        capturedAt: "2026-08-25T12:00:00.000Z",
        metadata: { relativePath: "01 Career & Job Search/Career.md" },
      });
      expect(store.markSourceMissing(note.id, scope).state).toBe("missing");
      const first = store.upsertDraftClaim({
        ...scope,
        sourceId: "portfolio:project:sample",
        logicalKey: "conflict-a",
        title: "Conflict A",
        proposition: "First reviewed proposition.",
        contribution: "Bounded contribution.",
        maturity: "prototype",
      });
      const second = store.upsertDraftClaim({
        ...scope,
        sourceId: "portfolio:project:sample",
        logicalKey: "conflict-b",
        title: "Conflict B",
        proposition: "Second reviewed proposition.",
        contribution: "Bounded contribution.",
        maturity: "prototype",
      });
      conflictId = store.declareClaimConflict({
        ...scope,
        claimIds: [first.id, second.id],
        reviewerId: "carl",
      }).id;
      store.upsertRelationship({
        id: "source-relationship:migrated",
        ...scope,
        sourceId: "portfolio:project:sample",
        claimId: null,
        fromKind: "project",
        fromId: "project:sample",
        relationship: "uses_skill",
        toKind: "skill",
        toId: "skill:typescript",
      });
      const candidate = store.listRelationshipCandidates(scope)[0]!;
      candidateId = candidate.id;
      store.decideRelationshipCandidate({
        ...scope,
        id: candidate.id,
        fingerprint: candidate.fingerprint,
        decision: "rejected",
        reviewerId: "carl",
      });
    } finally {
      store.close();
    }

    const reopened = new SqliteCareerEvidenceStore(databasePath);
    try {
      expect(reopened.listClaimConflicts(scope)).toEqual([
        expect.objectContaining({ id: conflictId, state: "unresolved" }),
      ]);
      expect(reopened.listRelationshipReviews(scope)).toEqual([
        expect.objectContaining({
          candidateId,
          decision: "rejected",
          reviewedBy: "carl",
        }),
      ]);
    } finally {
      reopened.close();
    }

    const database = new Database(databasePath, { readonly: true });
    try {
      expect(database.pragma("foreign_key_check")).toEqual([]);
      expect(database.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'career_claim_conflicts'",
      ).get()).toEqual({ name: "career_claim_conflicts" });
      expect(database.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'career_relationship_reviews'",
      ).get()).toEqual({ name: "career_relationship_reviews" });
    } finally {
      database.close();
    }
  });
});

const scope = { actorId: "carl", workspaceId: "professional" };

function createLegacyDatabase(databasePath: string): void {
  const database = new Database(databasePath);
  try {
    database.exec(`
      CREATE TABLE career_sources (
        id TEXT PRIMARY KEY,
        actor_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        source_type TEXT NOT NULL CHECK(source_type IN (
          'resume', 'employer_history', 'recommendation', 'project', 'repository',
          'release_artifact', 'portfolio_page', 'confirmed_fact'
        )),
        title TEXT NOT NULL,
        provenance_ref TEXT,
        provenance_uri TEXT,
        source_hash TEXT NOT NULL,
        captured_at TEXT NOT NULL,
        review_state TEXT NOT NULL CHECK(review_state IN ('needs_review', 'approved', 'rejected')),
        reviewed_by TEXT,
        last_reviewed_at TEXT,
        state TEXT NOT NULL CHECK(state IN ('active', 'revoked')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX career_sources_scope_review
        ON career_sources(actor_id, workspace_id, state, review_state, updated_at DESC);
      INSERT INTO career_sources VALUES (
        'portfolio:project:sample', 'carl', 'professional', 'project',
        'Sample', 'site/app/portfolio-data.ts#sample', 'https://example.com/sample',
        '${"a".repeat(64)}', '2026-08-25T12:00:00.000Z', 'needs_review',
        NULL, NULL, 'active', '2026-08-25T12:00:00.000Z',
        '2026-08-25T12:00:00.000Z'
      );
    `);
  } finally {
    database.close();
  }
}
