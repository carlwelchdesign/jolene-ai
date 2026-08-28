import { createHash } from "node:crypto";

import { stringify } from "yaml";
import { describe, expect, it } from "vitest";

import { preflightPersonalityPdfCapacityReviews } from
  "../src/personality/personality-pdf-capacity-review-preflight.js";

describe("personality PDF capacity review preflight", () => {
  it("rejects a one-tag review mutation before output can be considered", () => {
    const primary = { reviewer_id: "primary-reviewer", completed_at_utc:
      "2026-08-28T06:27:58Z", tool: "tool-a", model: ["model-a"],
    source_content_stored: false, tagged_units: { S04: [] } };
    const independent = { completed_at: "2026-08-28T06:12:01Z",
      reviewer: { reviewer_id: "independent-reviewer", tool: "tool-b", model: "model-b" },
      rights_audit: { source_content_persisted: false } };
    const primaryText = `${JSON.stringify(primary, null, 2)}\n`;
    const independentText = `${JSON.stringify(independent, null, 2)}\n`;
    const prerequisites = { sourceRegisterFingerprint: hash("register"),
      boundaryProtocolFingerprint: hash("protocol"), highRiskTaxonomyFingerprint:
      hash("taxonomy"), s04CueAmendmentFingerprint: hash("amendment") };
    const evidenceText = stringify({
      schema_version: "personality-pdf-capacity-review-evidence-v1",
      created_at: "2026-08-28T06:30:00Z",
      source_register_fingerprint: prerequisites.sourceRegisterFingerprint,
      boundary_protocol_fingerprint: prerequisites.boundaryProtocolFingerprint,
      high_risk_taxonomy_fingerprint: prerequisites.highRiskTaxonomyFingerprint,
      s04_cue_amendment_fingerprint: prerequisites.s04CueAmendmentFingerprint,
      primary_review: { fingerprint: hashText(primaryText), reviewer_id: "primary-reviewer",
        reviewer_type: "ai", tool: "tool-a", model_version: "model-a",
        reviewed_at: "2026-08-28T06:27:58Z", all_eligible_units_reviewed: 140,
        source_content_stored: false },
      independent_review: { fingerprint: hashText(independentText),
        reviewer_id: "independent-reviewer", reviewer_type: "ai", tool: "tool-b",
        model_version: "model-b", reviewed_at: "2026-08-28T06:12:01Z",
        all_eligible_units_reviewed: 140, source_content_stored: false },
    });
    expect(() => preflightPersonalityPdfCapacityReviews(
      primaryText, independentText, evidenceText, prerequisites,
    )).not.toThrow();
    const mutatedText = `${JSON.stringify({ ...primary,
      tagged_units: { S04: [{ locator: "changed", strata: ["humor"] }] },
    }, null, 2)}\n`;
    const untouchedOutput = "sentinel";
    expect(() => preflightPersonalityPdfCapacityReviews(
      mutatedText, independentText, evidenceText, prerequisites,
    )).toThrow("do not match frozen review evidence");
    expect(untouchedOutput).toBe("sentinel");
  });
});

function hash(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function hashText(value: string) {
  return hash(value);
}
