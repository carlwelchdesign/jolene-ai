import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { PortfolioEvidenceImporter } from "../src/application/portfolio-evidence-importer.js";
import {
  CareerEvidenceApprovalError,
  type UpsertCareerSourceInput,
} from "../src/domain/career-evidence.js";
import { SqliteCareerEvidenceStore } from "../src/persistence/sqlite-career-evidence-store.js";

const scope = { actorId: "carl", workspaceId: "professional" };
const fixedNow = new Date("2026-08-25T12:00:00.000Z");

describe("career evidence review lifecycle", () => {
  it("keeps imported claims private from the public export until source and claim approval", () => {
    const store = new SqliteCareerEvidenceStore(":memory:", () => fixedNow);
    try {
      const source = createSource(store);
      const claim = createClaim(store, source.id, "Evidence-backed product work.");

      expect(store.listPublicClaims(scope)).toEqual([]);
      expect(() =>
        store.decideClaim({
          ...scope,
          id: claim.id,
          decision: "approve_public",
          reviewerId: "carl",
        }),
      ).toThrow(CareerEvidenceApprovalError);

      store.decideSource({
        ...scope,
        id: source.id,
        decision: "approved",
        reviewerId: "carl",
      });
      const approved = store.decideClaim({
        ...scope,
        id: claim.id,
        decision: "approve_public",
        reviewerId: "carl",
      });

      expect(approved.visibility).toBe("public_approved");
      expect(store.listPublicClaims(scope).map((entry) => entry.id)).toEqual([
        claim.id,
      ]);
    } finally {
      store.close();
    }
  });

  it("rejects public approval without a public citation URI", () => {
    const store = new SqliteCareerEvidenceStore(":memory:", () => fixedNow);
    try {
      const source = createSource(store, {
        provenanceUri: null,
        provenanceRef: "private/resume.md#role",
      });
      const claim = createClaim(store, source.id, "Private-source claim.");
      store.decideSource({
        ...scope,
        id: source.id,
        decision: "approved",
        reviewerId: "carl",
      });

      expect(() =>
        store.decideClaim({
          ...scope,
          id: claim.id,
          decision: "approve_public",
          reviewerId: "carl",
        }),
      ).toThrowError(
        expect.objectContaining({
          issues: [expect.objectContaining({ code: "source_public_provenance_missing" })],
        }),
      );
    } finally {
      store.close();
    }
  });

  it("removes stale, superseded, and revoked evidence from public output", () => {
    let now = fixedNow;
    const store = new SqliteCareerEvidenceStore(":memory:", () => now);
    try {
      const source = createSource(store);
      const original = createClaim(store, source.id, "Original proposition.");
      approvePublic(store, source.id, original.id);
      expect(store.listPublicClaims(scope)).toHaveLength(1);

      const replacement = createClaim(store, source.id, "Corrected proposition.");
      expect(replacement.supersedesClaimId).toBe(original.id);
      expect(store.listClaims(scope).find((claim) => claim.id === original.id)?.state)
        .toBe("superseded");
      expect(store.listPublicClaims(scope)).toEqual([]);

      approvePublic(store, source.id, replacement.id);
      store.revokeClaim(replacement.id, scope);
      expect(store.listPublicClaims(scope)).toEqual([]);

      const current = createClaim(store, source.id, "Current proposition.");
      approvePublic(store, source.id, current.id);
      now = new Date("2027-02-23T12:00:00.000Z");
      expect(store.listPublicClaims(scope)).toEqual([]);
      expect(store.validate(scope)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "source_review_stale" }),
          expect.objectContaining({ code: "claim_review_stale", recordId: current.id }),
        ]),
      );
    } finally {
      store.close();
    }
  });

  it("resets source approval when imported source content changes", () => {
    const store = new SqliteCareerEvidenceStore(":memory:", () => fixedNow);
    try {
      const source = createSource(store);
      store.decideSource({
        ...scope,
        id: source.id,
        decision: "approved",
        reviewerId: "carl",
      });
      const changed = store.upsertSource({
        ...sourceInput(),
        sourceHash: digest("changed"),
      });
      expect(changed.reviewState).toBe("needs_review");
      expect(changed.reviewedBy).toBeNull();
      expect(changed.lastReviewedAt).toBeNull();
    } finally {
      store.close();
    }
  });

  it("removes every dependent claim when its source is revoked", () => {
    const store = new SqliteCareerEvidenceStore(":memory:", () => fixedNow);
    try {
      const source = createSource(store);
      const claim = createClaim(store, source.id, "Public proposition.");
      approvePublic(store, source.id, claim.id);
      expect(store.listPublicClaims(scope)).toHaveLength(1);

      expect(store.revokeSource(source.id, scope).state).toBe("revoked");
      expect(store.listPublicClaims(scope)).toEqual([]);

      const changed = store.upsertSource({
        ...sourceInput(),
        sourceHash: digest("changed after revocation"),
      });
      expect(changed.state).toBe("revoked");
      expect(store.listPublicClaims(scope)).toEqual([]);
    } finally {
      store.close();
    }
  });

  it("reports missing provenance and review requirements", () => {
    const store = new SqliteCareerEvidenceStore(":memory:", () => fixedNow);
    try {
      const source = store.upsertSource({
        ...sourceInput(),
        provenanceRef: null,
        provenanceUri: null,
      });
      createClaim(store, source.id, "Candidate proposition.");
      expect(store.validate(scope)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "source_missing_provenance" }),
          expect.objectContaining({ code: "source_public_provenance_missing" }),
          expect.objectContaining({ code: "source_review_required" }),
          expect.objectContaining({ code: "claim_review_required" }),
        ]),
      );
    } finally {
      store.close();
    }
  });

  it("persists, resolves, and safely reopens canonical claim conflicts", () => {
    let now = fixedNow;
    const store = new SqliteCareerEvidenceStore(":memory:", () => now);
    try {
      const source = createSource(store);
      const first = createClaim(store, source.id, "Carl led Atlas.", "atlas-a");
      const second = createClaim(store, source.id, "Carl advised Atlas.", "atlas-b");
      const third = createClaim(store, source.id, "Carl observed Atlas.", "atlas-c");

      const declared = store.declareClaimConflict({
        ...scope,
        claimIds: [second.id, first.id],
        reviewerId: "carl",
      });
      expect(declared).toMatchObject({
        claimIds: [first.id, second.id].sort(),
        state: "unresolved",
        reviewedBy: "carl",
        resolvedBy: null,
      });
      now = new Date("2026-08-25T13:00:00.000Z");
      expect(store.declareClaimConflict({
        ...scope,
        claimIds: [first.id, second.id],
        reviewerId: "carl",
      })).toEqual(declared);
      expect(() => store.declareClaimConflict({
        ...scope,
        claimIds: [second.id, third.id],
        reviewerId: "carl",
      })).toThrow("only one unresolved conflict");

      const resolved = store.resolveClaimConflict({
        ...scope,
        id: declared.id,
        reviewerId: "carl",
      });
      expect(resolved).toMatchObject({ state: "resolved", resolvedBy: "carl" });
      expect(store.resolveClaimConflict({
        ...scope,
        id: declared.id,
        reviewerId: "carl",
      })).toEqual(resolved);

      const reopened = store.declareClaimConflict({
        ...scope,
        claimIds: [first.id, second.id],
        reviewerId: "carl",
      });
      expect(reopened).toMatchObject({
        id: declared.id,
        state: "unresolved",
        resolvedBy: null,
      });
      expect(store.listClaimConflicts(scope)).toEqual([reopened]);
    } finally {
      store.close();
    }
  });

  it("requires an exact owner decision before creating a claim relationship", () => {
    const store = new SqliteCareerEvidenceStore(":memory:", () => fixedNow);
    try {
      const source = createSource(store);
      const claim = createClaim(store, source.id, "Carl built a bounded product.");
      store.upsertRelationship(sourceRelationshipInput(source.id));

      const candidate = store.listRelationshipCandidates(scope)[0]!;
      expect(candidate).toMatchObject({
        claimId: claim.id,
        sourceRelationshipId: "source-relationship:sample-skill",
        reviewState: "needs_review",
        reviewIsCurrent: false,
        linkedRelationshipId: null,
      });

      const approved = store.decideRelationshipCandidate({
        ...scope,
        id: candidate.id,
        fingerprint: candidate.fingerprint,
        decision: "approved",
        reviewerId: "carl",
      });
      expect(approved).toMatchObject({
        reviewState: "approved",
        reviewIsCurrent: true,
      });
      expect(store.listRelationships(scope)).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: approved.linkedRelationshipId,
          claimId: claim.id,
          relationship: "uses_skill",
          state: "active",
        }),
      ]));

      const rejected = store.decideRelationshipCandidate({
        ...scope,
        id: approved.id,
        fingerprint: approved.fingerprint,
        decision: "rejected",
        reviewerId: "carl",
      });
      expect(rejected).toMatchObject({
        reviewState: "rejected",
        claimQueueState: "exhausted",
        reviewIsCurrent: true,
        linkedRelationshipId: null,
      });
      expect(store.listRelationshipReviews(scope).map((review) => review.decision))
        .toEqual(["approved", "rejected"]);
      expect(store.listRelationships(scope).find((relationship) =>
        relationship.id === approved.linkedRelationshipId
      )?.state).toBe("revoked");
    } finally {
      store.close();
    }
  });

  it("advances one deterministic relationship option per unlinked claim", () => {
    const store = new SqliteCareerEvidenceStore(":memory:", () => fixedNow);
    try {
      const source = createSource(store);
      const firstClaim = createClaim(store, source.id, "First bounded claim.", "first");
      const secondClaim = createClaim(store, source.id, "Second bounded claim.", "second");
      for (const relationship of [
        {
          id: "source-relationship:related",
          relationship: "related_to" as const,
          toKind: "artifact" as const,
          toId: "artifact:portfolio",
        },
        {
          id: "source-relationship:domain",
          relationship: "in_domain" as const,
          toKind: "domain" as const,
          toId: "domain:applied-ai",
        },
        {
          id: "source-relationship:skill",
          relationship: "uses_skill" as const,
          toKind: "skill" as const,
          toId: "skill:typescript",
        },
      ]) {
        store.upsertRelationship({
          ...scope,
          ...relationship,
          sourceId: source.id,
          claimId: null,
          fromKind: "project",
          fromId: "project:sample",
        });
      }

      const initial = store.listRelationshipCandidates(scope);
      expect(initial).toHaveLength(2);
      expect(new Set(initial.map((candidate) => candidate.claimId))).toEqual(
        new Set([firstClaim.id, secondClaim.id]),
      );
      expect(initial.every((candidate) =>
        candidate.relationship === "uses_skill" &&
        candidate.claimQueueState === "pending"
      )).toBe(true);

      const firstOption = initial.find((candidate) => candidate.claimId === firstClaim.id)!;
      store.decideRelationshipCandidate({
        ...scope,
        id: firstOption.id,
        fingerprint: firstOption.fingerprint,
        decision: "rejected",
        reviewerId: "carl",
      });
      const afterRejection = store.listRelationshipCandidates(scope).filter(
        (candidate) => candidate.claimId === firstClaim.id,
      );
      expect(afterRejection).toHaveLength(2);
      expect(afterRejection.filter((candidate) => candidate.reviewState === "needs_review"))
        .toEqual([expect.objectContaining({
          relationship: "in_domain",
          claimQueueState: "pending",
        })]);
      expect(afterRejection.filter((candidate) => candidate.reviewState === "rejected"))
        .toEqual([expect.objectContaining({ id: firstOption.id })]);

      const nextOption = afterRejection.find(
        (candidate) => candidate.reviewState === "needs_review",
      )!;
      store.decideRelationshipCandidate({
        ...scope,
        id: nextOption.id,
        fingerprint: nextOption.fingerprint,
        decision: "approved",
        reviewerId: "carl",
      });
      expect(store.listRelationshipCandidates(scope).filter(
        (candidate) => candidate.claimId === firstClaim.id,
      )).toEqual([expect.objectContaining({
        id: nextOption.id,
        reviewState: "approved",
        claimQueueState: "approved",
      })]);
      expect(store.listRelationshipReviews(scope).map((review) => review.decision))
        .toEqual(["rejected", "approved"]);
    } finally {
      store.close();
    }
  });

  it("does not propose coverage links for claims that already have an active link", () => {
    const store = new SqliteCareerEvidenceStore(":memory:", () => fixedNow);
    try {
      const source = createSource(store);
      const claim = createClaim(store, source.id, "Already linked claim.");
      store.upsertRelationship(sourceRelationshipInput(source.id));
      store.upsertRelationship({
        id: "claim-relationship:existing",
        ...scope,
        sourceId: source.id,
        claimId: claim.id,
        fromKind: "claim",
        fromId: claim.id,
        relationship: "supports",
        toKind: "artifact",
        toId: "artifact:existing",
      });

      expect(store.listRelationshipCandidates(scope)).toEqual([]);
    } finally {
      store.close();
    }
  });

  it("bounds a canonical-shaped relationship cross product to one pending option per claim", () => {
    const store = new SqliteCareerEvidenceStore(":memory:", () => fixedNow);
    try {
      const source = createSource(store);
      for (let index = 0; index < 120; index += 1) {
        createClaim(store, source.id, `Bounded claim ${index}.`, `claim-${index}`);
      }
      for (let index = 0; index < 25; index += 1) {
        store.upsertRelationship({
          id: `source-relationship:related-${index}`,
          ...scope,
          sourceId: source.id,
          claimId: null,
          fromKind: "artifact",
          fromId: "artifact:career-note",
          relationship: "related_to",
          toKind: "artifact",
          toId: `artifact:reference-${index}`,
        });
      }

      const candidates = store.listRelationshipCandidates(scope);
      expect(candidates).toHaveLength(120);
      expect(new Set(candidates.map((candidate) => candidate.claimId)).size).toBe(120);
      expect(candidates.every((candidate) =>
        candidate.reviewState === "needs_review" &&
        candidate.claimQueueState === "pending" &&
        candidate.sourceRelationshipId === "source-relationship:related-0"
      )).toBe(true);
      expect(store.listRelationshipCandidates(scope).map((candidate) => candidate.id))
        .toEqual(candidates.map((candidate) => candidate.id));
    } finally {
      store.close();
    }
  });

  it("invalidates reviewed candidates when their exact source relationship changes", () => {
    let now = fixedNow;
    const store = new SqliteCareerEvidenceStore(":memory:", () => now);
    try {
      const source = createSource(store);
      createClaim(store, source.id, "Carl built a bounded product.");
      store.upsertRelationship(sourceRelationshipInput(source.id));
      const candidate = store.listRelationshipCandidates(scope)[0]!;
      store.decideRelationshipCandidate({
        ...scope,
        id: candidate.id,
        fingerprint: candidate.fingerprint,
        decision: "approved",
        reviewerId: "carl",
      });

      now = new Date("2026-08-25T13:00:00.000Z");
      store.upsertRelationship({
        ...sourceRelationshipInput(source.id),
        toId: "skill:reviewed-retrieval",
      });
      const changed = store.listRelationshipCandidates(scope)[0]!;
      expect(changed.id).toBe(candidate.id);
      expect(changed.fingerprint).not.toBe(candidate.fingerprint);
      expect(changed).toMatchObject({
        toId: "skill:reviewed-retrieval",
        reviewState: "needs_review",
        claimQueueState: "pending",
        reviewIsCurrent: false,
        linkedRelationshipId: null,
      });
      expect(() => store.decideRelationshipCandidate({
        ...scope,
        id: candidate.id,
        fingerprint: candidate.fingerprint,
        decision: "approved",
        reviewerId: "carl",
      })).toThrow("changed or is no longer active");

      store.revokeRelationshipsNotInSource(source.id, [], scope);
      expect(store.listRelationshipCandidates(scope)).toEqual([]);
    } finally {
      store.close();
    }
  });

  it("requires fresh relationship review after a source disappears and returns", () => {
    let now = fixedNow;
    const store = new SqliteCareerEvidenceStore(":memory:", () => now);
    try {
      const source = createSource(store);
      createClaim(store, source.id, "Carl built a bounded product.");
      store.upsertRelationship(sourceRelationshipInput(source.id));
      const candidate = store.listRelationshipCandidates(scope)[0]!;
      const approved = store.decideRelationshipCandidate({
        ...scope,
        id: candidate.id,
        fingerprint: candidate.fingerprint,
        decision: "approved",
        reviewerId: "carl",
      });

      now = new Date("2026-08-25T13:00:00.000Z");
      store.markSourceMissing(source.id, scope);
      expect(store.listRelationshipCandidates(scope)).toEqual([]);
      expect(store.listRelationships(scope).find((relationship) =>
        relationship.id === approved.linkedRelationshipId
      )?.state).toBe("revoked");

      now = new Date("2026-08-25T14:00:00.000Z");
      store.upsertSource(sourceInput());
      expect(store.listRelationshipCandidates(scope)[0]).toMatchObject({
        id: candidate.id,
        reviewState: "needs_review",
        reviewIsCurrent: false,
        linkedRelationshipId: null,
      });
    } finally {
      store.close();
    }
  });

  it("revokes a review-created relationship when its claim becomes inactive", () => {
    const store = new SqliteCareerEvidenceStore(":memory:", () => fixedNow);
    try {
      const source = createSource(store);
      const claim = createClaim(store, source.id, "Carl built a bounded product.");
      store.upsertRelationship(sourceRelationshipInput(source.id));
      const candidate = store.listRelationshipCandidates(scope)[0]!;
      const approved = store.decideRelationshipCandidate({
        ...scope,
        id: candidate.id,
        fingerprint: candidate.fingerprint,
        decision: "approved",
        reviewerId: "carl",
      });

      store.revokeClaim(claim.id, scope);
      expect(store.listRelationshipCandidates(scope)).toEqual([]);
      expect(store.listRelationships(scope).find((relationship) =>
        relationship.id === approved.linkedRelationshipId
      )?.state).toBe("revoked");
    } finally {
      store.close();
    }
  });
});

describe("PortfolioEvidenceImporter", () => {
  it("migrates portfolio records idempotently as review-required candidates", () => {
    const store = new SqliteCareerEvidenceStore(":memory:", () => fixedNow);
    try {
      const importer = new PortfolioEvidenceImporter(store);
      const first = importer.import(portfolioImportInput());
      const second = importer.import(portfolioImportInput());

      expect(first).toEqual({
        sourceCount: 4,
        claimCount: 6,
        relationshipCount: 4,
        validationIssueCount: 10,
        publicClaimCount: 0,
      });
      expect(second).toEqual(first);
      expect(store.listSources(scope).every((source) => source.reviewState === "needs_review"))
        .toBe(true);
      expect(store.listSources(scope).find((source) =>
        source.id === "portfolio:project:sample"
      )?.provenanceUri).toBe("/work/sample#evidence");
      expect(store.listClaims(scope).every((claim) =>
        claim.visibility === "public_candidate" && claim.reviewState === "needs_review"
      )).toBe(true);
    } finally {
      store.close();
    }
  });

  it("supersedes a changed portfolio claim instead of mutating reviewed history", () => {
    const store = new SqliteCareerEvidenceStore(":memory:", () => fixedNow);
    try {
      const importer = new PortfolioEvidenceImporter(store);
      importer.import(portfolioImportInput());
      const changed = portfolioImportInput();
      const snapshot = changed.snapshot as ReturnType<typeof portfolioSnapshot>;
      snapshot.projects[0]!.summary = "Updated project summary.";
      importer.import(changed);

      const summaryClaims = store.listClaims(scope).filter((claim) =>
        claim.sourceId === "portfolio:project:sample" && claim.logicalKey === "summary"
      );
      expect(summaryClaims).toHaveLength(2);
      expect(summaryClaims.map((claim) => claim.state).sort()).toEqual([
        "active",
        "superseded",
      ]);
    } finally {
      store.close();
    }
  });

  it("imports a corrected recommendation relationship into the replacement claim", () => {
    const store = new SqliteCareerEvidenceStore(":memory:", () => fixedNow);
    try {
      const importer = new PortfolioEvidenceImporter(store);
      const original = portfolioImportInput();
      const originalSnapshot = original.snapshot as ReturnType<typeof portfolioSnapshot>;
      originalSnapshot.recommendations[0]!.name = "David Allen";
      originalSnapshot.recommendations[0]!.date = "June 23, 2011";
      originalSnapshot.recommendations[0]!.relationship = "David was Carl’s client";
      originalSnapshot.recommendations[0]!.quote =
        "Carl did great work for us in web design and multimedia production. Super good guy to work with.";
      importer.import(original);

      const corrected = portfolioImportInput();
      const correctedSnapshot = corrected.snapshot as ReturnType<typeof portfolioSnapshot>;
      correctedSnapshot.recommendations[0]!.name = "David Allen";
      correctedSnapshot.recommendations[0]!.date = "June 23, 2011";
      correctedSnapshot.recommendations[0]!.relationship = "David was Carl’s employer";
      correctedSnapshot.recommendations[0]!.quote =
        "Carl did great work for us in web design and multimedia production. Super good guy to work with.";
      importer.import(corrected);

      const claims = store.listClaims(scope).filter((claim) =>
        claim.sourceId === "portfolio:recommendation:david-allen:june-23-2011"
      );
      expect(claims).toHaveLength(2);
      expect(claims.find((claim) => claim.state === "active")?.contribution).toContain(
        "David was Carl’s employer",
      );
      expect(claims.find((claim) => claim.state === "superseded")?.contribution).toContain(
        "David was Carl’s client",
      );
    } finally {
      store.close();
    }
  });
});

function createSource(
  store: SqliteCareerEvidenceStore,
  overrides: Partial<UpsertCareerSourceInput> = {},
) {
  return store.upsertSource({ ...sourceInput(), ...overrides });
}

function sourceInput() {
  return {
    id: "portfolio:project:sample",
    ...scope,
    sourceType: "project" as const,
    title: "Sample project",
    provenanceRef: "site/app/portfolio-data.ts#sample",
    provenanceUri: "https://example.com/sample",
    sourceHash: digest("sample"),
    capturedAt: fixedNow.toISOString(),
  };
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
    contribution: "Carl's contribution requires review.",
    maturity: "prototype",
  });
}

function approvePublic(
  store: SqliteCareerEvidenceStore,
  sourceId: string,
  claimId: string,
) {
  const source = store.listSources(scope).find((entry) => entry.id === sourceId);
  if (source?.reviewState !== "approved") {
    store.decideSource({
      ...scope,
      id: sourceId,
      decision: "approved",
      reviewerId: "carl",
    });
  }
  return store.decideClaim({
    ...scope,
    id: claimId,
    decision: "approve_public",
    reviewerId: "carl",
  });
}

function sourceRelationshipInput(sourceId: string) {
  return {
    id: "source-relationship:sample-skill",
    ...scope,
    sourceId,
    claimId: null,
    fromKind: "project" as const,
    fromId: "project:sample",
    relationship: "uses_skill" as const,
    toKind: "skill" as const,
    toId: "skill:typescript",
  };
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function portfolioImportInput() {
  return {
    ...scope,
    capturedAt: fixedNow.toISOString(),
    snapshot: portfolioSnapshot(),
  };
}

function portfolioSnapshot() {
  return {
    projects: [{
      slug: "sample",
      name: "Sample project",
      category: "Applied AI",
      status: "Deployed read-only portfolio demo",
      summary: "A bounded evidence product.",
      stack: ["TypeScript"],
      architecture: [{ id: "api", label: "API", detail: "Typed boundary" }],
      evidence: [{
        id: "portfolio:claim:sample:reviewed-evidence",
        text: "Uses reviewed evidence.",
        reviewState: "approved",
        publicApproved: true,
      }],
      boundaries: ["Not an autonomous decision maker."],
      repositoryUrl: "https://github.com/example/sample",
    }],
    experience: [{
      id: "example-co",
      company: "Example Co",
      role: "Senior Engineer",
      dates: "2020 — 2022",
      summary: "Built product systems.",
      stack: ["React"],
    }],
    recommendations: [{
      name: "Reviewer",
      headline: null,
      date: "August 25, 2026",
      relationship: "worked with Carl",
      quote: "Carl built thoughtful systems.",
    }],
    capabilities: [{
      id: "bounded-ai",
      name: "Bounded AI",
      summary: "Evidence remains visible.",
      practices: ["Provenance"],
      evidence: [{
        label: "Sample project",
        detail: "Evidence-backed workflow.",
        href: "/work/sample",
        source: "Case study" as const,
        reference: { kind: "project" as const, id: "sample" },
      }],
    }],
  };
}
