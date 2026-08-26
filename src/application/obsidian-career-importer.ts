import { createHash } from "node:crypto";

import type { CareerEvidenceStore } from "../domain/career-evidence.js";
import { parseObsidianCareerNote } from "../knowledge/obsidian-markdown.js";
import { ObsidianVaultReader } from "../knowledge/obsidian-vault.js";

export interface ObsidianCareerImporterOptions {
  readonly store: CareerEvidenceStore;
  readonly vaultRoot: string;
  readonly allowlist: readonly string[];
  readonly actorId: string;
  readonly workspaceId: string;
}

export interface ObsidianCareerImportReport {
  readonly documentsDiscovered: number;
  readonly documentsImported: number;
  readonly documentsSkipped: number;
  readonly missingSourceCount: number;
  readonly activeClaimCount: number;
  readonly supersededClaimCount: number;
  readonly activeRelationshipCount: number;
  readonly revokedRelationshipCount: number;
  readonly importedPublicClaimCount: number;
}

export class ObsidianCareerImporter {
  private readonly vault: ObsidianVaultReader;
  private readonly scope: { readonly actorId: string; readonly workspaceId: string };

  constructor(private readonly options: ObsidianCareerImporterOptions) {
    this.vault = new ObsidianVaultReader({
      vaultRoot: options.vaultRoot,
      allowlist: options.allowlist,
    });
    this.scope = {
      actorId: requireText(options.actorId, "actorId"),
      workspaceId: requireText(options.workspaceId, "workspaceId"),
    };
  }

  async import(): Promise<ObsidianCareerImportReport> {
    const documents = await this.vault.listMarkdownDocuments();
    const importedSourceIds = new Set<string>();
    let skipped = 0;

    for (const document of documents) {
      const parsed = parseObsidianCareerNote(
        document.relativePath,
        document.content,
      );
      if (!parsed.importEnabled) {
        skipped += 1;
        continue;
      }

      const sourceId = sourceIdForPath(document.relativePath);
      importedSourceIds.add(sourceId);
      this.options.store.upsertSource({
        id: sourceId,
        ...this.scope,
        sourceType: "career_note",
        title: parsed.title,
        provenanceRef: `obsidian:${document.relativePath}`,
        provenanceUri: null,
        sourceHash: digest(document.content),
        capturedAt: document.modifiedAt,
        metadata: {
          relativePath: document.relativePath,
          tags: parsed.tags,
          aliases: parsed.aliases,
          wikiLinks: parsed.wikiLinks,
          markdownLinks: parsed.markdownLinks,
          headings: parsed.headings,
          frontmatterKeys: parsed.frontmatterKeys,
          documentDate: parsed.documentDate,
        },
      });

      const activeClaimKeys: string[] = [];
      for (const section of parsed.sections) {
        activeClaimKeys.push(section.logicalKey);
        this.options.store.upsertDraftClaim({
          ...this.scope,
          sourceId,
          logicalKey: section.logicalKey,
          title: `${parsed.title} — ${section.heading}`,
          proposition: section.content,
          contribution:
            "Imported from a private career note; factual support and Carl's contribution require review.",
          maturity: "not_applicable",
          visibility: "private",
        });
      }
      this.options.store.supersedeClaimsNotInSource(
        sourceId,
        activeClaimKeys,
        this.scope,
      );

      const relationshipIds: string[] = [];
      for (const tag of parsed.tags) {
        const id = relationshipId(sourceId, "tag", tag);
        relationshipIds.push(id);
        this.options.store.upsertRelationship({
          id,
          ...this.scope,
          sourceId,
          claimId: null,
          fromKind: "artifact",
          fromId: document.relativePath,
          relationship: "in_domain",
          toKind: "domain",
          toId: tag,
        });
      }
      for (const link of parsed.wikiLinks) {
        const id = relationshipId(sourceId, "wiki", link);
        relationshipIds.push(id);
        this.options.store.upsertRelationship({
          id,
          ...this.scope,
          sourceId,
          claimId: null,
          fromKind: "artifact",
          fromId: document.relativePath,
          relationship: "related_to",
          toKind: "artifact",
          toId: link,
        });
      }
      this.options.store.revokeRelationshipsNotInSource(
        sourceId,
        relationshipIds,
        this.scope,
      );
    }

    const careerSources = this.options.store.listSources(this.scope)
      .filter((source) => source.sourceType === "career_note");
    for (const source of careerSources) {
      if (source.state === "active" && !importedSourceIds.has(source.id)) {
        this.options.store.markSourceMissing(source.id, this.scope);
      }
    }

    const currentSources = this.options.store.listSources(this.scope)
      .filter((source) => source.sourceType === "career_note");
    const sourceIds = new Set(currentSources.map((source) => source.id));
    const claims = this.options.store.listClaims(this.scope)
      .filter((claim) => sourceIds.has(claim.sourceId));
    const relationships = this.options.store.listRelationships(this.scope)
      .filter((relationship) => sourceIds.has(relationship.sourceId));

    return {
      documentsDiscovered: documents.length,
      documentsImported: importedSourceIds.size,
      documentsSkipped: skipped,
      missingSourceCount: currentSources.filter((source) => source.state === "missing").length,
      activeClaimCount: claims.filter((claim) => claim.state === "active").length,
      supersededClaimCount: claims.filter((claim) => claim.state === "superseded").length,
      activeRelationshipCount: relationships.filter((relationship) =>
        relationship.state === "active"
      ).length,
      revokedRelationshipCount: relationships.filter((relationship) =>
        relationship.state === "revoked"
      ).length,
      importedPublicClaimCount: claims.filter((claim) =>
        claim.visibility === "public_approved"
      ).length,
    };
  }
}

function sourceIdForPath(relativePath: string): string {
  return `obsidian:career:${digest(relativePath).slice(0, 24)}`;
}

function relationshipId(sourceId: string, kind: string, target: string): string {
  return `${sourceId}:${kind}:${digest(target).slice(0, 20)}`;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function requireText(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new RangeError(`${field} cannot be empty.`);
  return trimmed;
}
