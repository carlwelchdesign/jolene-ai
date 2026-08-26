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
});
