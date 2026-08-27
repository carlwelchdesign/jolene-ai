import { createHash } from "node:crypto";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  PublicCareerExportPolicyError,
  PublicCareerExportService,
} from "../src/application/public-career-export-service.js";
import {
  publicCareerConflictId,
  publicCareerEvidenceArtifactSchema,
} from "../src/domain/public-career-evidence.js";
import { SqliteCareerEvidenceStore } from "../src/persistence/sqlite-career-evidence-store.js";
import {
  readPublicCareerArtifact,
  writePublicCareerArtifact,
} from "../src/publication/public-career-artifact-writer.js";

const scope = { actorId: "carl", workspaceId: "professional" };
const fixedNow = new Date("2026-08-26T08:00:00.000Z");

describe("PublicCareerExportService", () => {
  it("emits a valid deterministic empty corpus without public approvals", () => {
    const store = new SqliteCareerEvidenceStore(":memory:", () => fixedNow);
    try {
      const first = new PublicCareerExportService(store, () => fixedNow).generate(scope);
      const later = new PublicCareerExportService(
        store,
        () => new Date("2026-08-27T08:00:00.000Z"),
      ).generate(scope);

      expect(first.evidence).toEqual([]);
      expect(first.manifest).toEqual({
        schemaVersion: "1.0.0",
        corpusVersion: "career:f218a8e06d12d725399b23539c03a8cd0ca4803e98f85e62421b65bf3ff87c7b",
        corpusHash: "sha256:f218a8e06d12d725399b23539c03a8cd0ca4803e98f85e62421b65bf3ff87c7b",
        generatedAt: fixedNow.toISOString(),
        reviewedAt: null,
        evidenceCount: 0,
        revokedEvidenceIds: [],
      });
      expect(later.manifest.corpusHash).toBe(first.manifest.corpusHash);
      expect(later.manifest.corpusVersion).toBe(first.manifest.corpusVersion);
      expect(later.manifest.generatedAt).not.toBe(first.manifest.generatedAt);
    } finally {
      store.close();
    }
  });

  it("exports only fresh public-approved claims as minimized contract records", () => {
    const store = new SqliteCareerEvidenceStore(":memory:", () => fixedNow);
    try {
      const source = createSource(store, {
        provenanceRef: "/Users/carl/private/portfolio-data.ts#project",
        metadata: {
          relativePath: "private/portfolio-data.ts",
          wikiLinks: ["Private Career Note"],
        },
      });
      const publicClaim = createClaim(store, source.id, "A reviewed public proposition.");
      approvePublic(store, source.id, publicClaim.id);
      const internalClaim = store.upsertDraftClaim({
        ...scope,
        sourceId: source.id,
        logicalKey: "internal",
        title: "Internal only",
        proposition: "This remains private to Jolene.",
        contribution: "Reviewed internal context.",
        maturity: "development",
        visibility: "private",
      });
      store.decideClaim({
        ...scope,
        id: internalClaim.id,
        decision: "approve_internal",
        reviewerId: "carl",
      });

      const artifact = new PublicCareerExportService(store, () => fixedNow).generate(scope);
      expect(artifact.manifest.evidenceCount).toBe(1);
      expect(artifact.evidence).toEqual([
        {
          evidenceId: `career:${publicClaim.id}`,
          claim: {
            claimId: publicClaim.id,
            text: "A reviewed public proposition.",
            evidenceIds: [`career:${publicClaim.id}`],
            evidenceStrength: "limited",
            maturity: "prototype",
            limitations: ["Contribution boundary: Carl's reviewed contribution."],
          },
          citation: {
            evidenceId: `career:${publicClaim.id}`,
            title: "Sample project",
            href: "/work/sample#evidence",
            sourceType: "project",
            strength: "limited",
            maturity: "prototype",
            lastReviewedAt: fixedNow.toISOString(),
          },
        },
      ]);
      const serialized = JSON.stringify(artifact);
      expect(serialized).not.toContain("/Users/carl");
      expect(serialized).not.toContain("portfolio-data.ts");
      expect(serialized).not.toContain("Private Career Note");
      expect(serialized).not.toContain("This remains private to Jolene");
      expect(serialized).not.toContain("actorId");
      expect(serialized).not.toContain("workspaceId");
    } finally {
      store.close();
    }
  });

  it("turns removed formerly-public records into deterministic revocations", () => {
    const store = new SqliteCareerEvidenceStore(":memory:", () => fixedNow);
    try {
      const source = createSource(store);
      const original = createClaim(store, source.id, "Original public proposition.");
      approvePublic(store, source.id, original.id);

      const replacement = createClaim(store, source.id, "Corrected candidate proposition.");
      const artifact = new PublicCareerExportService(store, () => fixedNow).generate(scope);

      expect(replacement.supersedesClaimId).toBe(original.id);
      expect(artifact.evidence).toEqual([]);
      expect(artifact.manifest.revokedEvidenceIds).toEqual([`career:${original.id}`]);
      expect(artifact.manifest.corpusHash).toBe(
        `sha256:${hash({
          schemaVersion: "1.0.0",
          evidence: [],
          revokedEvidenceIds: [`career:${original.id}`],
        })}`,
      );
    } finally {
      store.close();
    }
  });

  it("exports explicit unresolved conflicts without inferring them from prose", () => {
    const store = new SqliteCareerEvidenceStore(":memory:", () => fixedNow);
    try {
      const source = createSource(store);
      const first = createClaim(store, source.id, "Carl led the Atlas project.", "atlas-role-a");
      const second = createClaim(store, source.id, "Carl advised the Atlas project.", "atlas-role-b");
      approvePublic(store, source.id, first.id);
      approvePublic(store, source.id, second.id);
      const declared = store.declareClaimConflict({
        ...scope,
        claimIds: [first.id, second.id],
        reviewerId: "carl",
      });
      const evidenceIds = declared.claimIds.map((claimId) => `career:${claimId}`);
      const conflict = {
        conflictId: publicCareerConflictId(evidenceIds),
        evidenceIds,
        status: "unresolved" as const,
      };

      const artifact = new PublicCareerExportService(store, () => fixedNow)
        .generate(scope);

      expect(artifact.conflicts).toEqual([conflict]);
      expect(artifact.evidence).toHaveLength(2);
      expect(artifact.manifest.corpusHash).toBe(
        `sha256:${hash({
          schemaVersion: "1.0.0",
          evidence: artifact.evidence,
          revokedEvidenceIds: [],
          conflicts: [conflict],
        })}`,
      );
    } finally {
      store.close();
    }
  });

  it("rejects conflict declarations that do not resolve to active claims", () => {
    const store = new SqliteCareerEvidenceStore(":memory:", () => fixedNow);
    try {
      expect(() => store.declareClaimConflict({
        ...scope,
        claimIds: [
          "00000000-0000-4000-8000-000000000001",
          "00000000-0000-4000-8000-000000000002",
        ],
        reviewerId: "carl",
      })).toThrow();
    } finally {
      store.close();
    }
  });

  it("omits a public claim when another unresolved conflict member is not eligible", () => {
    const store = new SqliteCareerEvidenceStore(":memory:", () => fixedNow);
    try {
      const source = createSource(store);
      const publicClaim = createClaim(
        store,
        source.id,
        "Carl led the Atlas project.",
        "atlas-public",
      );
      const privateMember = createClaim(
        store,
        source.id,
        "Carl advised the Atlas project.",
        "atlas-private",
      );
      approvePublic(store, source.id, publicClaim.id);
      const conflict = store.declareClaimConflict({
        ...scope,
        claimIds: [publicClaim.id, privateMember.id],
        reviewerId: "carl",
      });
      const service = new PublicCareerExportService(store, () => fixedNow);

      const partial = service.generate(scope);
      expect(partial.evidence).toEqual([]);
      expect(partial.conflicts).toEqual([]);
      expect(partial.manifest.revokedEvidenceIds).toEqual([
        `career:${publicClaim.id}`,
      ]);

      approvePublic(store, source.id, privateMember.id);
      const complete = service.generate(scope, partial);
      expect(complete.evidence).toHaveLength(2);
      expect(complete.conflicts).toHaveLength(1);

      store.resolveClaimConflict({
        ...scope,
        id: conflict.id,
        reviewerId: "carl",
      });
      const resolved = service.generate(scope, complete);
      expect(resolved.evidence).toHaveLength(2);
      expect(resolved.conflicts).toEqual([]);
    } finally {
      store.close();
    }
  });

  it("carries prior exported IDs into revocations when current visibility is withdrawn", () => {
    const store = new SqliteCareerEvidenceStore(":memory:", () => fixedNow);
    try {
      const source = createSource(store);
      const claim = createClaim(store, source.id, "Initially public proposition.");
      approvePublic(store, source.id, claim.id);
      const service = new PublicCareerExportService(store, () => fixedNow);
      const previous = service.generate(scope);

      store.decideClaim({
        ...scope,
        id: claim.id,
        decision: "reject",
        reviewerId: "carl",
      });
      const current = service.generate(scope, previous);

      expect(current.evidence).toEqual([]);
      expect(current.manifest.revokedEvidenceIds).toEqual([`career:${claim.id}`]);
    } finally {
      store.close();
    }
  });

  it.each([
    ["Contact me at private@example.com", "/work/sample#evidence"],
    ["Call (555) 123-4567 for a private contact.", "/work/sample#evidence"],
    ["Read /Users/carl/private/resume.md", "/work/sample#evidence"],
    [
      `Secret ${["sk", "1234567890abcdefghijkl"].join("-")} should never export.`,
      "/work/sample#evidence",
    ],
    ["See [[Private Career Note]] for more.", "/work/sample#evidence"],
    ["Internal preview http://localhost:8421/memory", "/work/sample#evidence"],
    ["A safe proposition.", "https://example.com/work/sample"],
    ["A safe proposition.", "http://127.0.0.1:3000/work/sample"],
  ])("fails closed on private or unsafe export content", (proposition, href) => {
    const store = new SqliteCareerEvidenceStore(":memory:", () => fixedNow);
    try {
      const source = createSource(store, { provenanceUri: href });
      const claim = createClaim(store, source.id, proposition);
      approvePublic(store, source.id, claim.id);

      expect(() => new PublicCareerExportService(store, () => fixedNow).generate(scope))
        .toThrow(PublicCareerExportPolicyError);
    } finally {
      store.close();
    }
  });

  it("rejects public-approved career-note sources unsupported by the public contract", () => {
    const store = new SqliteCareerEvidenceStore(":memory:", () => fixedNow);
    try {
      const source = createSource(store, { sourceType: "career_note" });
      const claim = createClaim(store, source.id, "Reviewed but private-source claim.");
      approvePublic(store, source.id, claim.id);

      expect(() => new PublicCareerExportService(store, () => fixedNow).generate(scope))
        .toThrowError(expect.objectContaining({ code: "unsupported_source_type" }));
    } finally {
      store.close();
    }
  });
});

describe("writePublicCareerArtifact", () => {
  it("writes a validated artifact atomically with owner-only file permissions", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "jolene-public-export-"));
    const output = path.join(root, "nested", "artifact.json");
    const fixture = JSON.parse(
      await readFile(
        path.resolve("contracts/fixtures/public-career-evidence-empty.json"),
        "utf8",
      ),
    );
    const artifact = publicCareerEvidenceArtifactSchema.parse(fixture);

    await writePublicCareerArtifact(output, artifact);

    expect(JSON.parse(await readFile(output, "utf8"))).toEqual(artifact);
    expect(await readPublicCareerArtifact(output)).toEqual(artifact);
    expect((await stat(output)).mode & 0o777).toBe(0o600);
  });

  it("fails closed instead of replacing an invalid previous artifact", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "jolene-public-export-invalid-"));
    const output = path.join(root, "artifact.json");
    await writeFile(output, "{\"manifest\":{}}", "utf8");

    await expect(readPublicCareerArtifact(output)).rejects.toThrow();
    expect(await readFile(output, "utf8")).toBe("{\"manifest\":{}}");
  });
});

function createSource(
  store: SqliteCareerEvidenceStore,
  overrides: Record<string, unknown> = {},
) {
  return store.upsertSource({
    id: "portfolio:project:sample",
    ...scope,
    sourceType: "project",
    title: "Sample project",
    provenanceRef: "site/app/portfolio-data.ts#sample",
    provenanceUri: "/work/sample#evidence",
    sourceHash: hash("sample-source"),
    capturedAt: fixedNow.toISOString(),
    ...overrides,
  });
}

function createClaim(
  store: SqliteCareerEvidenceStore,
  sourceId: string,
  proposition: string,
  logicalKey = "summary",
) {
  return store.upsertDraftClaim({
    ...scope,
    sourceId,
    logicalKey,
    title: "Sample claim",
    proposition,
    contribution: "Carl's reviewed contribution.",
    maturity: "prototype",
  });
}

function approvePublic(
  store: SqliteCareerEvidenceStore,
  sourceId: string,
  claimId: string,
) {
  store.decideSource({
    ...scope,
    id: sourceId,
    decision: "approved",
    reviewerId: "carl",
  });
  store.decideClaim({
    ...scope,
    id: claimId,
    decision: "approve_public",
    reviewerId: "carl",
  });
}

function hash(value: unknown): string {
  return createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
}
