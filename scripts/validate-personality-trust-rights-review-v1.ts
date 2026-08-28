import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { fingerprint, personalityAdmissionAuditV1Schema } from
  "../src/personality/personality-admission-audit-v1.js";
import { personalityBehaviorSpecV1Schema } from
  "../src/personality/personality-behavior-spec-v1.js";
import { personalityCharacterGraphV1Schema } from
  "../src/personality/personality-character-graph-v1.js";
import { validatePersonalityTrustRightsReviewV1 } from
  "../src/personality/personality-trust-rights-review-v1.js";

export async function validatePersonalityTrustRightsReviewArtifactV1(
  projectRoot = process.cwd(),
) {
  const [reviewText, auditText, graphText, specificationText, rejectionLogText] =
    await Promise.all([
      readFile(path.resolve(projectRoot, "research/personality-trust-rights-review-v1.json"), "utf8"),
      readFile(path.resolve(projectRoot, "research/personality-admission-audit-v1.json"), "utf8"),
      readFile(path.resolve(projectRoot, "research/personality-character-graph-v1.json"), "utf8"),
      readFile(path.resolve(projectRoot, "research/personality-behavior-spec-v1.json"), "utf8"),
      readFile(path.resolve(projectRoot, "research/rejection-log.md"), "utf8"),
    ]);
  const review = validatePersonalityTrustRightsReviewV1(
    JSON.parse(reviewText),
    personalityAdmissionAuditV1Schema.parse(JSON.parse(auditText)),
    personalityCharacterGraphV1Schema.parse(JSON.parse(graphText)),
    personalityBehaviorSpecV1Schema.parse(JSON.parse(specificationText)),
    fingerprint(auditText),
    fingerprint(rejectionLogText),
  );
  return {
    reviewFingerprint: review.reviewFingerprint,
    reviewAreas: review.reviewAreas.length,
    releaseBlocks: review.reviewAreas.filter((area) => area.releaseBlock).length,
    sourceContentStored: review.evidenceSummary.sourceContentStored,
    maximumConsecutiveSourceOverlapWords:
      review.evidenceSummary.maximumConsecutiveSourceOverlapWords,
    voiceWork: review.releaseDisposition.voiceWork,
    legalClearance: review.releaseDisposition.legalClearance,
    runtimeActivation: review.releaseDisposition.runtimeActivation,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.stdout.write(`${JSON.stringify(
    await validatePersonalityTrustRightsReviewArtifactV1(), null, 2,
  )}\n`);
}
