import {
  PUBLIC_CAREER_EVIDENCE_SCHEMA_VERSION,
  publicCareerConflictId,
  publicCareerEvidenceArtifactSchema,
  publicCareerEvidenceDigest,
  type PublicCareerEvidenceConflict,
  type PublicCareerEvidenceArtifact,
  type PublicCareerEvidenceRecord,
} from "../../src/domain/public-career-evidence.js";

const reviewedAt = "2026-08-26T12:00:00.000Z";

export function createPublicEvidenceArtifact(
  evidence: readonly PublicCareerEvidenceRecord[] = [
    createPublicEvidenceRecord(1, {
      text: "Carl builds typed React product systems with explicit review boundaries.",
      title: "Typed product systems",
      href: "/work/typed-product-systems#evidence",
      maturity: "production",
    }),
    createPublicEvidenceRecord(2, {
      text: "Carl developed an interactive aviation project as a deployed demo.",
      title: "Interactive aviation project",
      href: "/work/aviation-project#evidence",
      maturity: "deployed_demo",
    }),
  ],
  conflicts: readonly PublicCareerEvidenceConflict[] = [],
): PublicCareerEvidenceArtifact {
  const revokedEvidenceIds: string[] = [];
  const digest = publicCareerEvidenceDigest({ evidence, revokedEvidenceIds, conflicts });
  return publicCareerEvidenceArtifactSchema.parse({
    manifest: {
      schemaVersion: PUBLIC_CAREER_EVIDENCE_SCHEMA_VERSION,
      corpusVersion: `career:${digest}`,
      corpusHash: `sha256:${digest}`,
      generatedAt: reviewedAt,
      reviewedAt,
      evidenceCount: evidence.length,
      revokedEvidenceIds,
    },
    evidence,
    conflicts,
  });
}

export function createPublicEvidenceConflict(
  evidenceIds: readonly string[],
): PublicCareerEvidenceConflict {
  const sortedEvidenceIds = [...evidenceIds].sort();
  return {
    conflictId: publicCareerConflictId(sortedEvidenceIds),
    evidenceIds: sortedEvidenceIds,
    status: "unresolved",
  };
}

export function createPublicEvidenceRecord(
  index: number,
  overrides: Partial<{
    readonly text: string;
    readonly title: string;
    readonly href: string;
    readonly sourceType: PublicCareerEvidenceRecord["citation"]["sourceType"];
    readonly maturity: PublicCareerEvidenceRecord["claim"]["maturity"];
    readonly limitations: readonly string[];
  }> = {},
): PublicCareerEvidenceRecord {
  const suffix = index.toString(16).padStart(12, "0");
  const claimId = `00000000-0000-4000-8000-${suffix}`;
  const evidenceId = `career:${claimId}`;
  const maturity = overrides.maturity ?? "development";
  const limitations = [...(overrides.limitations ?? [
    "The cited evidence supports only the claim as written.",
  ])];
  return {
    evidenceId,
    claim: {
      claimId,
      text: overrides.text ?? `Carl built reviewed project system ${index}.`,
      evidenceIds: [evidenceId],
      evidenceStrength: "limited",
      maturity,
      limitations,
    },
    citation: {
      evidenceId,
      title: overrides.title ?? `Reviewed project ${index}`,
      href: overrides.href ?? `/work/reviewed-project-${index}#evidence`,
      sourceType: overrides.sourceType ?? "portfolio_page",
      strength: "limited",
      maturity,
      lastReviewedAt: reviewedAt,
    },
  };
}
