import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { CareerRetrievalService } from "../src/application/career-retrieval-service.js";
import type {
  CareerEmbedding,
  CareerEmbeddingProvider,
  CareerRetrievalAuditStore,
  RecordCareerRetrievalAccessInput,
} from "../src/domain/career-retrieval.js";
import { CareerRetrievalAuthorizationError } from "../src/domain/career-retrieval.js";
import { SqliteCareerEvidenceStore } from "../src/persistence/sqlite-career-evidence-store.js";
import { SqliteCareerRetrievalAuditStore } from "../src/persistence/sqlite-career-retrieval-audit-store.js";
import { SqliteCareerRetrievalIndex } from "../src/persistence/sqlite-career-retrieval-index.js";

const scope = { actorId: "carl", workspaceId: "professional" } as const;
const fixedNow = new Date("2026-08-25T12:00:00.000Z");

describe("career hybrid retrieval", () => {
  it("filters unreviewed evidence before indexing or ranking", async () => {
    const fixture = createFixture(new SemanticEmbeddingProvider());
    try {
      const { sourceId, claimId } = addEvidence(fixture.evidence, {
        title: "TypeScript platform engineering",
        proposition: "Carl built typed product systems.",
      });

      expect(await fixture.index.synchronize(scope)).toMatchObject({
        eligibleClaimCount: 0,
        chunkCount: 0,
      });
      expect((await fixture.index.search("TypeScript", scope, 5)).results)
        .toEqual([]);

      approveInternal(fixture.evidence, sourceId, claimId);
      const response = await fixture.index.search("TypeScript", scope, 5);
      expect(response.mode).toBe("hybrid");
      expect(response.results).toHaveLength(1);
      expect(response.results[0]).toMatchObject({
        visibility: "internal_approved",
        citation: {
          sourceId,
          claimId,
          provenanceRef: "portfolio/sample#typescript-platform-engineering",
        },
      });
    } finally {
      fixture.close();
    }
  });

  it("uses vector similarity when the query and evidence share no lexical term", async () => {
    const fixture = createFixture(new SemanticEmbeddingProvider());
    try {
      const ids = addEvidence(fixture.evidence, {
        title: "TypeScript platform engineering",
        proposition: "Carl built typed product systems.",
      });
      approveInternal(fixture.evidence, ids.sourceId, ids.claimId);

      const response = await fixture.index.search("frontend specialist", scope, 5);
      expect(response.mode).toBe("hybrid");
      expect(response.results[0]).toMatchObject({
        citation: { claimId: ids.claimId },
      });
      expect(response.results[0]!.lexicalScore).toBe(0);
      expect(response.results[0]!.vectorScore).toBeGreaterThan(0);
    } finally {
      fixture.close();
    }
  });

  it("falls back deterministically to lexical retrieval when embeddings fail", async () => {
    const fixture = createFixture({ async embed() { return null; } });
    try {
      const ids = addEvidence(fixture.evidence, {
        title: "Evidence-grounded agent systems",
        proposition: "Carl designed approval-gated agent workflows.",
      });
      approveInternal(fixture.evidence, ids.sourceId, ids.claimId);

      const first = await fixture.index.search("approval agent", scope, 5);
      const second = await fixture.index.search("approval agent", scope, 5);
      expect(first.mode).toBe("lexical_fallback");
      expect(first).toEqual(second);
      expect(first.results[0]?.citation.claimId).toBe(ids.claimId);
    } finally {
      fixture.close();
    }
  });

  it("removes stale and revoked claims from the index before search", async () => {
    let now = fixedNow;
    const fixture = createFixture(new SemanticEmbeddingProvider(), () => now);
    try {
      const ids = addEvidence(fixture.evidence, {
        title: "Career evidence lifecycle",
        proposition: "Reviewed evidence expires and can be revoked.",
      });
      approveInternal(fixture.evidence, ids.sourceId, ids.claimId);
      expect((await fixture.index.search("lifecycle", scope, 5)).results)
        .toHaveLength(1);

      now = new Date("2027-02-23T12:00:00.000Z");
      expect(await fixture.index.synchronize(scope)).toMatchObject({
        eligibleClaimCount: 0,
        chunkCount: 0,
        removedChunkCount: 1,
      });

      now = fixedNow;
      const replacement = addEvidence(fixture.evidence, {
        sourceId: "portfolio:project:revocable",
        title: "Revocable evidence",
        proposition: "This record can be withdrawn.",
      });
      approveInternal(fixture.evidence, replacement.sourceId, replacement.claimId);
      expect((await fixture.index.search("withdrawn", scope, 5)).results)
        .toHaveLength(1);
      fixture.evidence.revokeClaim(replacement.claimId, scope);
      expect((await fixture.index.search("withdrawn", scope, 5)).results)
        .toEqual([]);
    } finally {
      fixture.close();
    }
  });

  it("authorizes only Carl in private channels and audits IDs without query text", async () => {
    const fixture = createFixture(new SemanticEmbeddingProvider());
    const audit = new SqliteCareerRetrievalAuditStore(":memory:", () => fixedNow);
    const service = new CareerRetrievalService({
      index: fixture.index,
      audit,
      corpusScope: scope,
      allowedActorIds: new Set(["carl", "UCARL"]),
      fingerprintKey: Buffer.alloc(32, 7),
    });
    try {
      const ids = addEvidence(fixture.evidence, {
        title: "Private professional context",
        proposition: "Only the owner may retrieve reviewed career evidence.",
      });
      approveInternal(fixture.evidence, ids.sourceId, ids.claimId);
      const response = await service.search({
        query: "private professional context",
        context: context(),
      });
      expect(response.results).toHaveLength(1);
      const records = audit.listAccesses(scope, 10);
      expect(records).toMatchObject([{
        status: "completed",
        mode: "hybrid",
        resultCount: 1,
        citations: [{ claimId: ids.claimId, sourceId: ids.sourceId }],
      }]);
      expect(records[0]?.queryFingerprint).toMatch(/^[a-f0-9]{64}$/);
      expect(JSON.stringify(records)).not.toContain("private professional context");
      expect(JSON.stringify(records)).not.toContain("Only the owner");

      await expect(service.search({
        query: "professional",
        context: context({ actorId: "jenny" }),
      })).rejects.toThrow(CareerRetrievalAuthorizationError);
      await expect(service.search({
        query: "professional",
        context: context({ channelKind: "slack_shared" }),
      })).rejects.toThrow(CareerRetrievalAuthorizationError);
    } finally {
      audit.close();
      fixture.close();
    }
  });

  it("fails closed when the audit ledger cannot commit", async () => {
    const fixture = createFixture(new SemanticEmbeddingProvider());
    const service = new CareerRetrievalService({
      index: fixture.index,
      audit: new FailingAuditStore(),
      corpusScope: scope,
      allowedActorIds: new Set(["carl"]),
    });
    try {
      const ids = addEvidence(fixture.evidence, {
        title: "Audited evidence",
        proposition: "Retrieval requires an audit record.",
      });
      approveInternal(fixture.evidence, ids.sourceId, ids.claimId);
      await expect(service.search({
        query: "audited evidence",
        context: context(),
      })).rejects.toThrow("Synthetic audit failure");
    } finally {
      fixture.close();
    }
  });
});

class SemanticEmbeddingProvider implements CareerEmbeddingProvider {
  async embed(texts: readonly string[]): Promise<readonly CareerEmbedding[]> {
    return texts.map((text) => ({
      model: "semantic-test-v1",
      vector: semanticVector(text),
    }));
  }
}

function semanticVector(text: string): readonly number[] {
  const normalized = text.toLowerCase();
  if (
    normalized.includes("typescript") ||
    normalized.includes("frontend specialist")
  ) return [1, 0, 0];
  if (normalized.includes("approval") || normalized.includes("agent")) {
    return [0, 1, 0];
  }
  return [0, 0, 1];
}

class FailingAuditStore implements CareerRetrievalAuditStore {
  recordAccess(_input: RecordCareerRetrievalAccessInput): never {
    throw new Error("Synthetic audit failure");
  }

  listAccesses(): readonly never[] {
    return [];
  }

  close(): void {}
}

function createFixture(
  embeddings: CareerEmbeddingProvider,
  now: () => Date = () => fixedNow,
) {
  const evidence = new SqliteCareerEvidenceStore(":memory:", now);
  const index = new SqliteCareerRetrievalIndex(":memory:", evidence, embeddings, now);
  return {
    evidence,
    index,
    close() {
      index.close();
      evidence.close();
    },
  };
}

function addEvidence(
  store: SqliteCareerEvidenceStore,
  input: {
    readonly sourceId?: string;
    readonly title: string;
    readonly proposition: string;
  },
) {
  const sourceId = input.sourceId ?? "portfolio:project:sample";
  const source = store.upsertSource({
    id: sourceId,
    ...scope,
    sourceType: "project",
    title: input.title,
    provenanceRef: `portfolio/sample#${slug(input.title)}`,
    provenanceUri: null,
    sourceHash: createHash("sha256").update(input.title).digest("hex"),
    capturedAt: fixedNow.toISOString(),
    metadata: { tags: ["typescript", "ai"] },
  });
  const claim = store.upsertDraftClaim({
    ...scope,
    sourceId: source.id,
    logicalKey: "summary",
    title: input.title,
    proposition: input.proposition,
    contribution: "Carl designed and implemented the bounded system.",
    maturity: "deployed_demo",
    visibility: "private",
  });
  return { sourceId: source.id, claimId: claim.id };
}

function approveInternal(
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
    decision: "approve_internal",
    reviewerId: "carl",
  });
}

function context(overrides: Record<string, unknown> = {}) {
  return {
    eventId: "event-1",
    actorId: "carl",
    workspaceId: "personal",
    channelKind: "private_chat" as const,
    channelId: "local",
    threadId: "main",
    ...overrides,
  };
}

function slug(value: string): string {
  return value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-");
}
