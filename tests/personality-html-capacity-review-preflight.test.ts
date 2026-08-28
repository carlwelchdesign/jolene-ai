import { createHash } from "node:crypto";

import { stringify } from "yaml";
import { describe, expect, it } from "vitest";

import { preflightPersonalityHtmlCapacityReviews } from
  "../src/personality/personality-html-capacity-review-preflight.js";

const sha = (value: string) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const prerequisite = {
  sourceRegisterFingerprint: `sha256:${"1".repeat(64)}`,
  boundaryProtocolFingerprint: `sha256:${"2".repeat(64)}`,
  highRiskTaxonomyFingerprint: `sha256:${"3".repeat(64)}`,
};

describe("personality HTML capacity review preflight", () => {
  it("binds distinct complete reports to the frozen evidence", () => {
    const primary = report("primary", "primary-reviewer", "2026-08-28T07:00:00Z");
    const independent = report(
      "independent", "independent-reviewer", "2026-08-28T07:01:00Z",
    );
    const evidence = evidenceFor(primary, independent);
    expect(preflightPersonalityHtmlCapacityReviews(
      primary, independent, evidence, prerequisite,
    )).toMatchObject({
      primaryReviewFingerprint: sha(primary),
      independentReviewFingerprint: sha(independent),
    });
  });

  it("rejects a changed report, shared reviewer, and stale prerequisite", () => {
    const primary = report("primary", "primary-reviewer", "2026-08-28T07:00:00Z");
    const independent = report(
      "independent", "independent-reviewer", "2026-08-28T07:01:00Z",
    );
    const evidence = evidenceFor(primary, independent);
    expect(() => preflightPersonalityHtmlCapacityReviews(
      `${primary}\n`, independent, evidence, prerequisite,
    )).toThrow("do not match frozen review evidence");
    const shared = report("independent", "primary-reviewer", "2026-08-28T07:01:00Z");
    expect(() => preflightPersonalityHtmlCapacityReviews(
      primary, shared, evidenceFor(primary, shared), prerequisite,
    )).toThrow("do not match frozen review evidence");
    expect(() => preflightPersonalityHtmlCapacityReviews(
      primary, independent, evidence, { ...prerequisite, sourceRegisterFingerprint: sha("stale") },
    )).toThrow("do not match frozen review evidence");
  });
});

function report(role: "primary" | "independent", reviewerId: string, reviewedAt: string) {
  return JSON.stringify({
    schema_version: "personality-html-capacity-review-v1",
    review_role: role,
    reviewer: { reviewer_id: reviewerId, tool: "test", model: "test-model", reviewed_at: reviewedAt },
    source_register_fingerprint: prerequisite.sourceRegisterFingerprint,
    boundary_protocol_fingerprint: prerequisite.boundaryProtocolFingerprint,
    high_risk_taxonomy_fingerprint: prerequisite.highRiskTaxonomyFingerprint,
    eligible_units_reviewed: 448,
    rights_audit: { source_content_persisted: false },
  });
}

function evidenceFor(primaryText: string, independentText: string) {
  const primary = JSON.parse(primaryText);
  const independent = JSON.parse(independentText);
  return stringify({
    schema_version: "personality-html-capacity-review-evidence-v1",
    created_at: "2026-08-28T07:02:00Z",
    source_register_fingerprint: prerequisite.sourceRegisterFingerprint,
    boundary_protocol_fingerprint: prerequisite.boundaryProtocolFingerprint,
    high_risk_taxonomy_fingerprint: prerequisite.highRiskTaxonomyFingerprint,
    primary_review: reviewEvidence(primary, sha(primaryText)),
    independent_review: reviewEvidence(independent, sha(independentText)),
  });
}

function reviewEvidence(report: Record<string, any>, fingerprint: string) {
  return {
    fingerprint,
    reviewer_id: report.reviewer.reviewer_id,
    reviewer_type: "ai",
    tool: report.reviewer.tool,
    model_version: report.reviewer.model,
    reviewed_at: report.reviewer.reviewed_at,
    all_eligible_units_reviewed: 448,
    source_content_stored: false,
  };
}
