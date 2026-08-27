import { createHash } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runPortfolioEvidenceImportAudit } from "../src/application/portfolio-evidence-import-audit.js";
import { PortfolioEvidenceImporter } from "../src/application/portfolio-evidence-importer.js";
import { SqliteCareerEvidenceStore } from "../src/persistence/sqlite-career-evidence-store.js";

const scope = { actorId: "carl", workspaceId: "professional" };
const capturedAt = "2026-08-26T08:00:00.000Z";

describe("runPortfolioEvidenceImportAudit", () => {
  it("preserves unchanged approvals and never mutates the source database", async () => {
    const databasePath = await approvedFixtureDatabase();
    const before = await digestFile(databasePath);

    const report = await runPortfolioEvidenceImportAudit({
      databasePath,
      importInput: importInput(snapshot(), "2026-08-27T08:00:00.000Z"),
    });

    expect(report).toMatchObject({
      canonicalDatabaseModified: false,
      eligiblePublicClaimsBefore: 1,
      eligiblePublicClaimsAfter: 1,
      sourceApprovalsInvalidated: 0,
      publicClaimApprovalsInvalidated: 0,
      validationIssueCount: 0,
    });
    expect(await digestFile(databasePath)).toBe(before);
  });

  it("reports changed public evidence as review-required without exposing content", async () => {
    const databasePath = await approvedFixtureDatabase();
    const changed = snapshot();
    changed.projects[0]!.summary = "A materially changed public summary.";

    const report = await runPortfolioEvidenceImportAudit({
      databasePath,
      importInput: importInput(changed, "2026-08-27T08:00:00.000Z"),
    });

    expect(report).toMatchObject({
      canonicalDatabaseModified: false,
      eligiblePublicClaimsBefore: 1,
      eligiblePublicClaimsAfter: 0,
      sourceApprovalsInvalidated: 1,
      publicClaimApprovalsInvalidated: 1,
      validationIssueCounts: {
        source_review_required: 1,
        claim_review_required: 1,
      },
    });
    expect(JSON.stringify(report)).not.toContain("materially changed");
  });
});

async function approvedFixtureDatabase(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "jolene-portfolio-audit-test-"));
  const databasePath = path.join(root, "jolene.sqlite");
  const store = new SqliteCareerEvidenceStore(databasePath, () => new Date(capturedAt));
  try {
    new PortfolioEvidenceImporter(store).import(importInput(snapshot(), capturedAt));
    const source = store.listSources(scope)[0]!;
    store.decideSource({ ...scope, id: source.id, decision: "approved", reviewerId: "carl" });
    const claim = store.listClaims(scope)[0]!;
    store.decideClaim({ ...scope, id: claim.id, decision: "approve_public", reviewerId: "carl" });
  } finally {
    store.close();
  }
  return databasePath;
}

function importInput(value: ReturnType<typeof snapshot>, timestamp: string) {
  return { ...scope, capturedAt: timestamp, snapshot: value };
}

function snapshot() {
  return {
    projects: [{
      slug: "sample",
      name: "Sample",
      category: "Applied AI",
      status: "Production",
      summary: "A reviewed public summary.",
      stack: [],
      architecture: [],
      evidence: [],
      boundaries: [],
      repositoryUrl: "https://example.com/sample",
    }],
    experience: [],
    recommendations: [],
    capabilities: [],
  };
}

async function digestFile(filePath: string): Promise<string> {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}
