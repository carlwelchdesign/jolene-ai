import { createHash } from "node:crypto";

import {
  PUBLIC_CAREER_EVIDENCE_SCHEMA_VERSION,
  publicCareerEvidenceArtifactSchema,
  publicCareerEvidenceDigest,
  type PublicCareerEvidenceArtifact,
  type PublicCareerEvidenceRecord,
} from "../domain/public-career-evidence.js";
import {
  PUBLIC_CAREER_CHAPTER_LIMITATION,
  PUBLIC_CAREER_ROLE_LIMITATION,
  type PublicCareerProfileDossier,
} from "../domain/public-career-profile-dossier.js";
import type { PublicArtifactSource } from "./public-artifact-source.js";

export class PublicCareerProfileArtifactSource implements PublicArtifactSource {
  constructor(
    private readonly source: PublicArtifactSource,
    private readonly dossier: PublicCareerProfileDossier,
  ) {}

  async read(): Promise<PublicCareerEvidenceArtifact | null> {
    const artifact = await this.source.read();
    return artifact ? mergePublicCareerProfile(artifact, this.dossier) : null;
  }
}

export function mergePublicCareerProfile(
  artifact: PublicCareerEvidenceArtifact,
  dossier: PublicCareerProfileDossier,
): PublicCareerEvidenceArtifact {
  const profileEvidence = [
    ...dossier.chapters.map((entry) => profileRecord("chapter", entry, dossier)),
    ...dossier.roles.map((entry) => profileRecord("role", entry, dossier)),
  ];
  const profileIds = new Set(profileEvidence.map((record) => record.evidenceId));
  const evidence = [
    ...artifact.evidence.filter((record) => !profileIds.has(record.evidenceId)),
    ...profileEvidence,
  ].sort((left, right) => left.evidenceId.localeCompare(right.evidenceId));
  const revokedEvidenceIds = artifact.manifest.revokedEvidenceIds
    .filter((evidenceId) => !profileIds.has(evidenceId));
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
      reviewedAt: latestTimestamp(artifact.manifest.reviewedAt, dossier.reviewedAt),
      evidenceCount: evidence.length,
      revokedEvidenceIds,
    },
    evidence,
    conflicts: artifact.conflicts,
  });
}

function profileRecord(
  kind: "chapter" | "role",
  entry: PublicCareerProfileDossier["chapters"][number],
  dossier: PublicCareerProfileDossier,
): PublicCareerEvidenceRecord {
  const claimId = stableProfileClaimId(`${kind}:${entry.slug}`);
  const evidenceId = `career:${claimId}` as const;
  return {
    evidenceId,
    claim: {
      claimId,
      text: entry.claim,
      evidenceIds: [evidenceId],
      evidenceStrength: entry.evidenceStrength,
      maturity: entry.maturity,
      limitations: [kind === "chapter"
        ? PUBLIC_CAREER_CHAPTER_LIMITATION
        : PUBLIC_CAREER_ROLE_LIMITATION],
    },
    citation: {
      evidenceId,
      title: entry.citation.title,
      href: entry.citation.href,
      sourceType: entry.citation.sourceType,
      strength: entry.evidenceStrength,
      maturity: entry.maturity,
      lastReviewedAt: dossier.reviewedAt,
    },
  };
}

function stableProfileClaimId(value: string): string {
  const digest = createHash("sha256")
    .update(`public-career-profile:${value}`)
    .digest("hex")
    .slice(0, 32);
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
