import { createHash } from "node:crypto";

import {
  PUBLIC_CAREER_EVIDENCE_SCHEMA_VERSION,
  publicCareerEvidenceArtifactSchema,
  publicCareerEvidenceDigest,
  type PublicCareerEvidenceArtifact,
  type PublicCareerEvidenceRecord,
} from "../domain/public-career-evidence.js";
import {
  PUBLIC_RESUME_PROJECT_DELIVERY_LIMITATION,
  type PublicResumeProjectDossier,
} from "../domain/public-resume-project-dossier.js";
import type { PublicArtifactSource } from "./public-artifact-source.js";

export class PublicResumeProjectArtifactSource implements PublicArtifactSource {
  constructor(
    private readonly source: PublicArtifactSource,
    private readonly dossier: PublicResumeProjectDossier,
  ) {}

  async read(): Promise<PublicCareerEvidenceArtifact | null> {
    const artifact = await this.source.read();
    return artifact ? mergePublicResumeProjects(artifact, this.dossier) : null;
  }
}

export function mergePublicResumeProjects(
  artifact: PublicCareerEvidenceArtifact,
  dossier: PublicResumeProjectDossier,
): PublicCareerEvidenceArtifact {
  const resumeEvidence = dossier.projects.map((project) =>
    resumeProjectRecord(dossier, project)
  );
  const resumeIds = new Set(resumeEvidence.map((record) => record.evidenceId));
  const evidence = [
    ...artifact.evidence.filter((record) => !resumeIds.has(record.evidenceId)),
    ...resumeEvidence,
  ].sort((left, right) => left.evidenceId.localeCompare(right.evidenceId));
  const revokedEvidenceIds = artifact.manifest.revokedEvidenceIds
    .filter((evidenceId) => !resumeIds.has(evidenceId));
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
        dossier.reviewedAt,
      ),
      evidenceCount: evidence.length,
      revokedEvidenceIds,
    },
    evidence,
    conflicts: artifact.conflicts,
  });
}

function resumeProjectRecord(
  dossier: PublicResumeProjectDossier,
  project: PublicResumeProjectDossier["projects"][number],
): PublicCareerEvidenceRecord {
  const claimId = stableResumeProjectClaimId(project.slug);
  const evidenceId = `career:${claimId}` as const;
  return {
    evidenceId,
    claim: {
      claimId,
      text: project.claim,
      evidenceIds: [evidenceId],
      evidenceStrength: project.evidenceStrength,
      maturity: project.maturity,
      limitations: [PUBLIC_RESUME_PROJECT_DELIVERY_LIMITATION],
    },
    citation: {
      evidenceId,
      title: project.name,
      href: dossier.citationHref,
      sourceType: "resume",
      strength: project.evidenceStrength,
      maturity: project.maturity,
      lastReviewedAt: dossier.reviewedAt,
    },
  };
}

function stableResumeProjectClaimId(slug: string): string {
  const digest = createHash("sha256")
    .update(`public-resume-project:${slug}`)
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
