import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { fingerprint, personalityAdmissionAuditV1Schema } from
  "../src/personality/personality-admission-audit-v1.js";
import { personalityBehaviorSpecV1Schema } from
  "../src/personality/personality-behavior-spec-v1.js";
import { personalityCharacterGraphV1Schema } from
  "../src/personality/personality-character-graph-v1.js";
import {
  buildPersonalityTrustRightsReviewV1,
  validatePersonalityTrustRightsReviewV1,
} from "../src/personality/personality-trust-rights-review-v1.js";

async function artifacts() {
  const [reviewText, auditText, graphText, specificationText, rejectionLogText] =
    await Promise.all([
      readFile(new URL(
        "../research/personality-trust-rights-review-v1.json", import.meta.url,
      ), "utf8"),
      readFile(new URL(
        "../research/personality-admission-audit-v1.json", import.meta.url,
      ), "utf8"),
      readFile(new URL(
        "../research/personality-character-graph-v1.json", import.meta.url,
      ), "utf8"),
      readFile(new URL(
        "../research/personality-behavior-spec-v1.json", import.meta.url,
      ), "utf8"),
      readFile(new URL("../research/rejection-log.md", import.meta.url), "utf8"),
    ]);
  return {
    review: JSON.parse(reviewText),
    audit: personalityAdmissionAuditV1Schema.parse(JSON.parse(auditText)),
    graph: personalityCharacterGraphV1Schema.parse(JSON.parse(graphText)),
    specification: personalityBehaviorSpecV1Schema.parse(JSON.parse(specificationText)),
    auditFingerprint: fingerprint(auditText),
    rejectionLogFingerprint: fingerprint(rejectionLogText),
  };
}

describe("personality trust and rights review v1", () => {
  it("covers every required risk while preserving non-release boundaries", async () => {
    const input = await artifacts();
    const review = validatePersonalityTrustRightsReviewV1(
      input.review, input.audit, input.graph, input.specification,
      input.auditFingerprint, input.rejectionLogFingerprint,
    );
    expect(review.reviewAreas).toHaveLength(10);
    expect(review.reviewAreas.every((area) => area.releaseBlock)).toBe(true);
    expect(review.releaseDisposition).toMatchObject({
      runtimeActivation: "not-authorized-by-this-review",
      voiceWork: "blocked-pending-original-voice-and-rights-gate",
      legalClearance: "not-established",
    });
  });

  it("retains content-minimization and evidence boundaries", async () => {
    const { review } = await artifacts();
    expect(review.evidenceSummary).toMatchObject({
      maximumConsecutiveSourceOverlapWords: 3,
      eightWordSourceOverlaps: 0,
      sourceContentStored: false,
      excerptsStored: false,
      lyricsStored: false,
      excludedRightsRiskTurns: 67,
      antiCaricatureConstraints: 7,
    });
  });

  it("rebuilds deterministically from exact reviewed sources", async () => {
    const input = await artifacts();
    expect(buildPersonalityTrustRightsReviewV1(
      input.audit, input.graph, input.specification,
      input.auditFingerprint, input.rejectionLogFingerprint,
    )).toEqual(input.review);
  });

  it("rejects a weakened risk decision", async () => {
    const input = await artifacts();
    const changed = structuredClone(input.review);
    changed.reviewAreas[0].releaseBlock = false;
    expect(() => validatePersonalityTrustRightsReviewV1(
      changed, input.audit, input.graph, input.specification,
      input.auditFingerprint, input.rejectionLogFingerprint,
    )).toThrow("does not match its reviewed source artifacts");
  });
});
