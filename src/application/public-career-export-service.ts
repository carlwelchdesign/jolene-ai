import type {
  CareerClaim,
  CareerEvidenceScope,
  CareerEvidenceStore,
  CareerSource,
} from "../domain/career-evidence.js";
import {
  PUBLIC_CAREER_EVIDENCE_SCHEMA_VERSION,
  publicCareerEvidenceDigest,
  publicCareerEvidenceArtifactSchema,
  type PublicCareerEvidenceArtifact,
  type PublicCareerEvidenceRecord,
} from "../domain/public-career-evidence.js";
import {
  containsForbiddenPublicText,
  isPrivateHostname,
} from "../domain/public-disclosure-policy.js";

const PUBLIC_SOURCE_TYPES = new Set([
  "resume",
  "employer_history",
  "recommendation",
  "project",
  "repository",
  "release_artifact",
  "portfolio_page",
  "confirmed_fact",
]);

export class PublicCareerExportService {
  constructor(
    private readonly store: CareerEvidenceStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  generate(
    scope: CareerEvidenceScope,
    previous: PublicCareerEvidenceArtifact | null = null,
  ): PublicCareerEvidenceArtifact {
    const generatedAt = this.now().toISOString();
    const sources = new Map(
      this.store.listSources(scope).map((source) => [source.id, source]),
    );
    const eligibleClaims = [...this.store.listPublicClaims(scope)]
      .sort((left, right) => evidenceId(left).localeCompare(evidenceId(right)));
    const eligibleIds = new Set(eligibleClaims.map(evidenceId));
    const evidence = eligibleClaims.map((claim) =>
      this.toPublicRecord(claim, requireSource(sources, claim.sourceId))
    );
    const previouslyKnownIds = previous
      ? [
          ...previous.evidence.map((record) => record.evidenceId),
          ...previous.manifest.revokedEvidenceIds,
        ]
      : [];
    const revokedEvidenceIds = [
      ...new Set([
        ...this.store.listClaims(scope)
          .filter((claim) =>
            claim.visibility === "public_approved" &&
            !eligibleIds.has(evidenceId(claim))
          )
          .map(evidenceId),
        ...previouslyKnownIds.filter((id) => !eligibleIds.has(id)),
      ]),
    ].sort();

    const digest = publicCareerEvidenceDigest({
      evidence,
      revokedEvidenceIds,
    });
    const reviewedAt = latestReview(evidence) ?? generatedAt;

    return publicCareerEvidenceArtifactSchema.parse({
      manifest: {
        schemaVersion: PUBLIC_CAREER_EVIDENCE_SCHEMA_VERSION,
        corpusVersion: `career:${digest}`,
        corpusHash: `sha256:${digest}`,
        generatedAt,
        reviewedAt,
        evidenceCount: evidence.length,
        revokedEvidenceIds,
      },
      evidence,
    });
  }

  private toPublicRecord(
    claim: CareerClaim,
    source: CareerSource,
  ): PublicCareerEvidenceRecord {
    if (!PUBLIC_SOURCE_TYPES.has(source.sourceType)) {
      throw new PublicCareerExportPolicyError("unsupported_source_type");
    }
    if (!claim.lastReviewedAt || !source.lastReviewedAt) {
      throw new PublicCareerExportPolicyError("missing_review_timestamp");
    }

    const href = requirePublicHref(source.provenanceUri);
    const id = evidenceId(claim);
    const limitation = `Contribution boundary: ${claim.contribution}`;
    for (const value of [source.title, claim.proposition, limitation, href]) {
      assertPublicText(value);
    }

    const lastReviewedAt = earlierTimestamp(
      claim.lastReviewedAt,
      source.lastReviewedAt,
    );
    return {
      evidenceId: id,
      claim: {
        claimId: claim.id,
        text: claim.proposition,
        evidenceIds: [id],
        evidenceStrength: "limited",
        maturity: claim.maturity,
        limitations: [limitation],
      },
      citation: {
        evidenceId: id,
        title: source.title,
        href,
        sourceType: source.sourceType as PublicCareerEvidenceRecord["citation"]["sourceType"],
        strength: "limited",
        maturity: claim.maturity,
        lastReviewedAt,
      },
    };
  }
}

export class PublicCareerExportPolicyError extends Error {
  constructor(readonly code: string) {
    super(`Public career export blocked by policy: ${code}.`);
    this.name = "PublicCareerExportPolicyError";
  }
}

function evidenceId(claim: CareerClaim): string {
  return `career:${claim.id}`;
}

function requireSource(
  sources: ReadonlyMap<string, CareerSource>,
  sourceId: string,
): CareerSource {
  const source = sources.get(sourceId);
  if (!source) throw new PublicCareerExportPolicyError("source_not_found");
  return source;
}

function requirePublicHref(value: string | null): string {
  if (!value) throw new PublicCareerExportPolicyError("public_href_missing");
  if (value.startsWith("/") && !value.startsWith("//")) {
    if (value.includes("\\") || decodedSegments(value).includes("..")) {
      throw new PublicCareerExportPolicyError("public_href_invalid");
    }
    return value;
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new PublicCareerExportPolicyError("public_href_invalid");
  }
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    isPrivateHostname(parsed.hostname)
  ) {
    throw new PublicCareerExportPolicyError("public_href_invalid");
  }
  return value;
}

function decodedSegments(value: string): readonly string[] {
  try {
    return decodeURIComponent(value).split("/");
  } catch {
    throw new PublicCareerExportPolicyError("public_href_invalid");
  }
}

function assertPublicText(value: string): void {
  if (containsForbiddenPublicText(value)) {
    throw new PublicCareerExportPolicyError("forbidden_public_content");
  }
}

function earlierTimestamp(left: string, right: string): string {
  return new Date(left) <= new Date(right) ? left : right;
}

function latestReview(
  evidence: readonly PublicCareerEvidenceRecord[],
): string | null {
  return evidence.reduce<string | null>((latest, record) => {
    const reviewedAt = record.citation.lastReviewedAt;
    return !latest || new Date(reviewedAt) > new Date(latest)
      ? reviewedAt
      : latest;
  }, null);
}
