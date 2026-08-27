import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runPublicCareerExport } from "../src/application/public-career-export-runner.js";
import { publicCareerEvidenceArtifactSchema } from "../src/domain/public-career-evidence.js";
import { SqliteCareerEvidenceStore } from "../src/persistence/sqlite-career-evidence-store.js";

const scope = { actorId: "carl", workspaceId: "professional" };
const fixedNow = new Date("2026-08-27T04:00:00.000Z");

describe("runPublicCareerExport", () => {
  it("reads an existing registry without mutating it and writes a valid artifact", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "jolene-runtime-export-"));
    const databasePath = path.join(root, "data", "jolene.sqlite");
    const outputPath = path.join(root, "exports", "public-career-evidence.json");
    const writer = new SqliteCareerEvidenceStore(databasePath, () => fixedNow);
    const source = writer.upsertSource({
      ...scope,
      id: "portfolio:project:sample",
      sourceType: "project",
      title: "Sample project",
      provenanceRef: "portfolio-data.ts#sample",
      provenanceUri: "/work/sample#evidence",
      sourceHash: "a".repeat(64),
      capturedAt: fixedNow.toISOString(),
    });
    const claim = writer.upsertDraftClaim({
      ...scope,
      sourceId: source.id,
      logicalKey: "summary",
      title: "Sample evidence",
      proposition: "Carl delivered the reviewed sample project.",
      contribution: "Carl's reviewed contribution.",
      maturity: "production",
    });
    writer.decideSource({
      ...scope,
      id: source.id,
      decision: "approved",
      reviewerId: "carl",
    });
    writer.decideClaim({
      ...scope,
      id: claim.id,
      decision: "approve_public",
      reviewerId: "carl",
    });
    writer.close();

    const result = await runPublicCareerExport({
      ...scope,
      databasePath,
      outputPath,
    });
    const artifact = publicCareerEvidenceArtifactSchema.parse(
      JSON.parse(await readFile(outputPath, "utf8")),
    );

    expect(result.outputPath).toBe(path.resolve(outputPath));
    expect(result.evidenceCount).toBe(1);
    expect(result.revokedEvidenceIds).toEqual([]);
    expect(artifact.manifest).toEqual({
      schemaVersion: result.schemaVersion,
      corpusVersion: result.corpusVersion,
      corpusHash: result.corpusHash,
      generatedAt: result.generatedAt,
      reviewedAt: result.reviewedAt,
      evidenceCount: 1,
      revokedEvidenceIds: [],
    });
    expect(artifact.evidence[0]?.claim.text).toBe(
      "Carl delivered the reviewed sample project.",
    );

    const reader = new SqliteCareerEvidenceStore(
      databasePath,
      () => fixedNow,
      { readOnly: true },
    );
    try {
      expect(reader.listPublicClaims(scope)).toHaveLength(1);
      expect(() => reader.decideClaim({
        ...scope,
        id: claim.id,
        decision: "approve_internal",
        reviewerId: "carl",
      })).toThrow();
    } finally {
      reader.close();
    }
  });

  it("fails closed when the canonical database does not exist", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "jolene-runtime-export-missing-"));
    const databasePath = path.join(root, "missing", "jolene.sqlite");

    await expect(runPublicCareerExport({
      ...scope,
      databasePath,
      outputPath: path.join(root, "exports", "artifact.json"),
    })).rejects.toThrow();
  });
});
