import { createHash } from "node:crypto";

import {
  PUBLIC_CAREER_EVIDENCE_SCHEMA_VERSION,
  publicCareerEvidenceArtifactSchema,
  publicCareerEvidenceDigest,
  type PublicCareerEvidenceArtifact,
  type PublicCareerEvidenceRecord,
} from "../domain/public-career-evidence.js";
import type { PublicJoleneProjectDossier } from
  "../domain/public-jolene-project-dossier.js";
import type { PublicArtifactSource } from "./public-artifact-source.js";

const DOSSIER_LIMITATION =
  "This public case study does not provide access to Carl's private tools, memory, notes, or messages.";

export class PublicJoleneDossierArtifactSource implements PublicArtifactSource {
  constructor(
    private readonly source: PublicArtifactSource,
    private readonly dossier: PublicJoleneProjectDossier,
  ) {}

  async read(): Promise<PublicCareerEvidenceArtifact | null> {
    const artifact = await this.source.read();
    return artifact ? mergePublicJoleneDossier(artifact, this.dossier) : null;
  }
}

export function mergePublicJoleneDossier(
  artifact: PublicCareerEvidenceArtifact,
  dossier: PublicJoleneProjectDossier,
): PublicCareerEvidenceArtifact {
  const dossierEvidence = dossier.claims.map((claim) =>
    dossierRecord(dossier, claim)
  );
  const dossierIds = new Set(dossierEvidence.map((record) => record.evidenceId));
  const evidence = [
    ...artifact.evidence.filter((record) => !dossierIds.has(record.evidenceId)),
    ...dossierEvidence,
  ].sort((left, right) => left.evidenceId.localeCompare(right.evidenceId));
  const revokedEvidenceIds = artifact.manifest.revokedEvidenceIds
    .filter((evidenceId) => !dossierIds.has(evidenceId));
  const digest = publicCareerEvidenceDigest({
    evidence,
    revokedEvidenceIds,
    conflicts: artifact.conflicts,
  });
  return publicCareerEvidenceArtifactSchema.parse({
    manifest: {
      schemaVersion: PUBLIC_CAREER_EVIDENCE_SCHEMA_VERSION,
      corpusVersion: `career:${digest}`,
      corpusHash: `sha256:${digest}`,
      generatedAt: artifact.manifest.generatedAt,
      reviewedAt: latestTimestamp(
        artifact.manifest.reviewedAt,
        dossier.project.reviewedAt,
      ),
      evidenceCount: evidence.length,
      revokedEvidenceIds,
    },
    evidence,
    conflicts: artifact.conflicts,
  });
}

function dossierRecord(
  dossier: PublicJoleneProjectDossier,
  claim: PublicJoleneProjectDossier["claims"][number],
): PublicCareerEvidenceRecord {
  const claimId = stableDossierClaimId(`${dossier.project.slug}:${claim.id}`);
  const evidenceId = `career:${claimId}` as const;
  return {
    evidenceId,
    claim: {
      claimId,
      text: claim.text,
      evidenceIds: [evidenceId],
      evidenceStrength: dossier.project.evidenceStrength,
      maturity: dossier.project.maturity,
      limitations: [DOSSIER_LIMITATION],
    },
    citation: {
      evidenceId,
      title: claim.citation.title,
      href: claim.citation.href,
      sourceType: "project",
      strength: dossier.project.evidenceStrength,
      maturity: dossier.project.maturity,
      lastReviewedAt: dossier.project.reviewedAt,
    },
  };
}

function stableDossierClaimId(value: string): string {
  const digest = createHash("sha256").update(value).digest("hex").slice(0, 32);
  const versioned = `${digest.slice(0, 12)}5${digest.slice(13)}`;
  const variant = `${versioned.slice(0, 16)}${
    ((Number.parseInt(versioned[16] ?? "0", 16) & 0x3) | 0x8).toString(16)
  }${versioned.slice(17)}`;
  return [
    variant.slice(0, 8),
    variant.slice(8, 12),
    variant.slice(12, 16),
    variant.slice(16, 20),
    variant.slice(20),
  ].join("-");
}

function latestTimestamp(left: string | null, right: string): string {
  return left && Date.parse(left) > Date.parse(right) ? left : right;
}
