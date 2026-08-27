import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { SqliteCareerEvidenceStore } from
  "../../src/persistence/sqlite-career-evidence-store.js";

export const mcpScope = {
  actorId: "carl",
  workspaceId: "professional",
} as const;
export const mcpFixedNow = new Date("2026-08-27T05:00:00.000Z");

export interface SeededMcpDatabase {
  readonly root: string;
  readonly databasePath: string;
  readonly internalClaimId: string;
  readonly publicClaimId: string;
  readonly unapprovedClaimId: string;
}

export function seedPrivateCareerMcpDatabase(): SeededMcpDatabase {
  const root = mkdtempSync(path.join(tmpdir(), "jolene-private-mcp-"));
  const databasePath = path.join(root, "jolene.sqlite");
  const store = new SqliteCareerEvidenceStore(databasePath, () => mcpFixedNow);
  try {
    const internalClaimId = addClaim(store, {
      sourceId: "portfolio:project:typed-platform",
      sourceTitle: "Typed platform project",
      claimTitle: "TypeScript product engineering",
      proposition: "Carl built TypeScript and React product systems.",
      contribution: "Carl designed the architecture and implemented the product workflow.",
      visibility: "internal",
      provenanceRef: "portfolio/typed-platform#evidence",
    });
    const publicClaimId = addClaim(store, {
      sourceId: "portfolio:project:audio-product",
      sourceTitle: "Audio product project",
      claimTitle: "C++ audio product engineering",
      proposition: "Carl develops C++ audio products and host-loadable plugins.",
      contribution: "Carl owns product design and implementation.",
      visibility: "public",
      provenanceRef: "portfolio/audio-product#evidence",
    });
    const unapprovedClaimId = addClaim(store, {
      sourceId: "career-note:private-draft",
      sourceTitle: "Unreviewed private note",
      claimTitle: "Sensitive unreviewed detail",
      proposition: "This text must never enter approved retrieval.",
      contribution: "This unreviewed contribution must remain excluded.",
      visibility: "unapproved",
      provenanceRef: "obsidian:private-draft",
    });
    return {
      root,
      databasePath,
      internalClaimId,
      publicClaimId,
      unapprovedClaimId,
    };
  } finally {
    store.close();
  }
}

function addClaim(
  store: SqliteCareerEvidenceStore,
  input: {
    readonly sourceId: string;
    readonly sourceTitle: string;
    readonly claimTitle: string;
    readonly proposition: string;
    readonly contribution: string;
    readonly visibility: "internal" | "public" | "unapproved";
    readonly provenanceRef: string;
  },
): string {
  store.upsertSource({
    id: input.sourceId,
    ...mcpScope,
    sourceType: input.sourceId.startsWith("career-note:")
      ? "career_note"
      : "project",
    title: input.sourceTitle,
    provenanceRef: input.provenanceRef,
    provenanceUri: input.visibility === "public"
      ? "/work/audio-product#evidence"
      : null,
    sourceHash: createHash("sha256").update(input.proposition).digest("hex"),
    capturedAt: mcpFixedNow.toISOString(),
  });
  const claim = store.upsertDraftClaim({
    ...mcpScope,
    sourceId: input.sourceId,
    logicalKey: input.claimTitle.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-"),
    title: input.claimTitle,
    proposition: input.proposition,
    contribution: input.contribution,
    maturity: "released_product",
    ...(input.visibility === "unapproved" ? { visibility: "private" as const } : {}),
  });
  store.decideSource({
    id: input.sourceId,
    ...mcpScope,
    decision: "approved",
    reviewerId: mcpScope.actorId,
  });
  if (input.visibility !== "unapproved") {
    store.decideClaim({
      id: claim.id,
      ...mcpScope,
      decision: input.visibility === "public"
        ? "approve_public"
        : "approve_internal",
      reviewerId: mcpScope.actorId,
    });
  }
  return claim.id;
}
