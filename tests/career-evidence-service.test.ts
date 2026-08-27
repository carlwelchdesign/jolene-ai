import { describe, expect, it } from "vitest";

import {
  CareerEvidenceScopeError,
  CareerEvidenceService,
} from "../src/application/career-evidence-service.js";
import { SqliteCareerEvidenceStore } from "../src/persistence/sqlite-career-evidence-store.js";

describe("CareerEvidenceService", () => {
  it("locks reads and decisions to the configured owner scope", () => {
    const store = new SqliteCareerEvidenceStore(":memory:");
    const scope = { actorId: "carl", workspaceId: "professional" };
    const service = new CareerEvidenceService(store, scope);
    try {
      expect(service.scope()).toEqual(scope);
      expect(service.listSources(scope)).toEqual([]);
      expect(service.listClaimConflicts(scope)).toEqual([]);
      expect(() => service.listSources({ actorId: "other", workspaceId: "professional" }))
        .toThrow(CareerEvidenceScopeError);
      expect(() => service.validate({ actorId: "carl", workspaceId: "other" }))
        .toThrow(CareerEvidenceScopeError);
      expect(() => service.decideSource({
        ...scope,
        id: "missing-source",
        decision: "approved",
        reviewerId: "other",
      })).toThrow(CareerEvidenceScopeError);
      expect(() => service.declareClaimConflict({
        ...scope,
        claimIds: [
          "00000000-0000-4000-8000-000000000001",
          "00000000-0000-4000-8000-000000000002",
        ],
        reviewerId: "other",
      })).toThrow(CareerEvidenceScopeError);
      expect(() => service.resolveClaimConflict({
        ...scope,
        id: "conflict:0000000000000000",
        reviewerId: "other",
      })).toThrow(CareerEvidenceScopeError);
    } finally {
      store.close();
    }
  });

  it("exposes candidates and restricts exact relationship decisions to the owner", () => {
    const store = new SqliteCareerEvidenceStore(":memory:");
    const scope = { actorId: "carl", workspaceId: "professional" };
    const service = new CareerEvidenceService(store, scope);
    try {
      store.upsertSource({
        id: "source:sample",
        ...scope,
        sourceType: "project",
        title: "Sample",
        provenanceRef: "portfolio/sample",
        provenanceUri: "https://example.com/sample",
        sourceHash: "a".repeat(64),
        capturedAt: "2026-08-25T12:00:00.000Z",
      });
      store.upsertDraftClaim({
        ...scope,
        sourceId: "source:sample",
        logicalKey: "summary",
        title: "Sample claim",
        proposition: "Carl built Sample.",
        contribution: "Bounded contribution.",
        maturity: "prototype",
      });
      store.upsertRelationship({
        id: "relationship:source-skill",
        ...scope,
        sourceId: "source:sample",
        claimId: null,
        fromKind: "project",
        fromId: "project:sample",
        relationship: "uses_skill",
        toKind: "skill",
        toId: "skill:typescript",
      });

      const candidate = service.listRelationshipCandidates(scope)[0]!;
      expect(service.listRelationshipReviews(scope)).toEqual([]);
      expect(() => service.decideRelationshipCandidate({
        ...scope,
        id: candidate.id,
        fingerprint: candidate.fingerprint,
        decision: "approved",
        reviewerId: "other",
      })).toThrow(CareerEvidenceScopeError);
      expect(service.decideRelationshipCandidate({
        ...scope,
        id: candidate.id,
        fingerprint: candidate.fingerprint,
        decision: "approved",
        reviewerId: "carl",
      }).reviewState).toBe("approved");
      expect(service.listRelationshipReviews(scope)).toHaveLength(1);
    } finally {
      store.close();
    }
  });
});
