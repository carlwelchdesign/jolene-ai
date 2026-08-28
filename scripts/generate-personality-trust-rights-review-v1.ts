import { readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { fingerprint, personalityAdmissionAuditV1Schema } from
  "../src/personality/personality-admission-audit-v1.js";
import { personalityBehaviorSpecV1Schema } from
  "../src/personality/personality-behavior-spec-v1.js";
import { personalityCharacterGraphV1Schema } from
  "../src/personality/personality-character-graph-v1.js";
import { buildPersonalityTrustRightsReviewV1 } from
  "../src/personality/personality-trust-rights-review-v1.js";

export async function generatePersonalityTrustRightsReviewV1(projectRoot = process.cwd()) {
  const [auditText, graphText, specificationText, rejectionLogText] = await Promise.all([
    readFile(path.resolve(projectRoot, "research/personality-admission-audit-v1.json"), "utf8"),
    readFile(path.resolve(projectRoot, "research/personality-character-graph-v1.json"), "utf8"),
    readFile(path.resolve(projectRoot, "research/personality-behavior-spec-v1.json"), "utf8"),
    readFile(path.resolve(projectRoot, "research/rejection-log.md"), "utf8"),
  ]);
  const review = buildPersonalityTrustRightsReviewV1(
    personalityAdmissionAuditV1Schema.parse(JSON.parse(auditText)),
    personalityCharacterGraphV1Schema.parse(JSON.parse(graphText)),
    personalityBehaviorSpecV1Schema.parse(JSON.parse(specificationText)),
    fingerprint(auditText),
    fingerprint(rejectionLogText),
  );
  const outputPath = path.resolve(projectRoot, "research/personality-trust-rights-review-v1.json");
  const temporaryPath = `${outputPath}.${process.pid}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(review, null, 2)}\n`, { mode: 0o600 });
    await rename(temporaryPath, outputPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
  return { outputPath, review };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { outputPath, review } = await generatePersonalityTrustRightsReviewV1();
  process.stdout.write(`${JSON.stringify({
    outputPath,
    reviewFingerprint: review.reviewFingerprint,
    reviewAreas: review.reviewAreas.length,
    releaseBlocks: review.reviewAreas.filter((area) => area.releaseBlock).length,
    legalClearance: review.releaseDisposition.legalClearance,
    runtimeActivation: review.releaseDisposition.runtimeActivation,
  }, null, 2)}\n`);
}
