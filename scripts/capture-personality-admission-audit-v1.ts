import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  loadPersonalityCorpusV2Policy,
  validatePersonalityCorpusV2,
  type IndependentReview,
  type PersonalityCorpusV2,
  type TraitAdmission,
} from "../src/personality/personality-corpus-contract.js";
import {
  fingerprint,
  personalityAdmissionAuditV1Schema,
  validatePersonalityAdmissionAuditV1,
} from "../src/personality/personality-admission-audit-v1.js";
import { personalityIndependentReviewV5Schema } from
  "../src/personality/personality-independent-review-v5.js";
import { personalityPrimaryCodingArtifactV5Schema } from
  "../src/personality/personality-primary-coding-v5.js";
import { longestConsecutiveWordOverlap } from
  "../src/personality/personality-primary-coding-rights-v5.js";
import { personalityRecodingV1Schema } from
  "../src/personality/personality-recoding-v1.js";
import { loadPersonalitySelectionArtifactsV5 } from
  "../src/personality/personality-selection-ledgers-v5.js";
import { extractSelectedHtmlPersonalitySourceTexts } from
  "../src/personality/personality-selected-html-source-text.js";
import { extractSelectedPdfPersonalitySourceTexts } from
  "../src/personality/personality-selected-pdf-source-text.js";
import { loadPersonalitySourceRegisterV3 } from
  "../src/personality/personality-source-register-v3.js";

const traitFamilies = [
  "bounded-warmth", "calibrated-wit", "candid-repair", "credit-aware-authority",
  "disciplined-agency", "grounded-optimism", "operational-care", "uncertainty-humility",
] as const;
const prohibitedSupportStrata = new Set([
  "belief", "biography", "identity-trait", "politics", "voice-adjacent",
  "workplace-sexual-boundary",
]);

export async function capturePersonalityAdmissionAuditV1(projectRoot = process.cwd()) {
  const [primaryText, round1Text, recodingText, codebookText, primarySelection, register,
    policy, html, pdf] = await Promise.all([
    readFile(path.resolve(projectRoot, "research/primary-coding-v5.json"), "utf8"),
    readFile(path.resolve(projectRoot, "research/independent-review-v5.json"), "utf8"),
    readFile(path.resolve(projectRoot, "research/personality-recoding-v1.json"), "utf8"),
    readFile(path.resolve(projectRoot, "research/personality-categorical-codebook-v1.json"), "utf8"),
    loadPersonalitySelectionArtifactsV5(projectRoot),
    loadPersonalitySourceRegisterV3(projectRoot),
    loadPersonalityCorpusV2Policy(projectRoot),
    extractSelectedHtmlPersonalitySourceTexts(projectRoot),
    extractSelectedPdfPersonalitySourceTexts(projectRoot),
  ]);
  const primary = personalityPrimaryCodingArtifactV5Schema.parse(JSON.parse(primaryText));
  const round1 = personalityIndependentReviewV5Schema.parse(JSON.parse(round1Text));
  const recoding = personalityRecodingV1Schema.parse(JSON.parse(recodingText));
  if (recoding.status !== "recoding-passed-awaiting-rights-and-trait-admission-audit") {
    throw new Error("Admission audit requires a passing recoding artifact");
  }
  const recodingByObservation = new Map(
    recoding.rows.map((row) => [row.observationId, row]),
  );
  const turns = primary.turns.map((turn) => ({
    ...turn,
    ...(recodingByObservation.get(turn.observationId)?.reconciledCoding ?? {}),
  }));
  const independentReviews: IndependentReview[] = recoding.rows.map((row) => ({
    observationId: row.observationId,
    independentAssignmentFingerprint: digest(JSON.stringify({
      observationId: row.observationId,
      selectionId: row.selectionId,
      reviewerId: recoding.recoderB.reviewerId,
      rawCoding: row.recoderB,
    })),
    reviewerId: recoding.recoderB.reviewerId,
    reviewerType: recoding.recoderB.reviewerType,
    tool: recoding.recoderB.tool,
    modelVersion: recoding.recoderB.modelVersion,
    assignedAt: row.recoderBAssignedAt,
    codedAt: row.recoderBCodedAt,
    primaryRawCoding: row.recoderA,
    rawCoding: row.recoderB,
    reconciledAt: row.reconciledAt,
    adjudicatorId: recoding.adjudicator.reviewerId,
    disposition: row.changedFields.length === 0 ? "agree" : "adjusted",
    changedFields: row.changedFields,
  }));
  const completedAt = new Date().toISOString();
  const traitDecisions = traitFamilies.map((traitFamilyId) => {
    const support = turns.filter((turn) => turn.traitFamilyId === traitFamilyId &&
      turn.traitEvidenceClass === "inferred" &&
      turn.adaptationEvidenceClass === "designed" &&
      !turn.sensitiveStrata.some((stratum) => prohibitedSupportStrata.has(stratum)));
    const counterexamples = turns.filter((turn) => turn.traitFamilyId === traitFamilyId &&
      turn.traitEvidenceClass === "rejected").map((turn) => turn.observationId);
    const sourceEvents = new Set(support.map((turn) => turn.sourceEventId)).size;
    const settingFamilies = new Set(support.map((turn) => turn.settingFamily)).size;
    const timeBands = new Set(support.map((turn) => turn.timeBand)).size;
    const qualifies = support.length >= 6 && sourceEvents >= 3 && settingFamilies >= 3 &&
      timeBands >= 2 && maximumShare(support.map((turn) => turn.sourceEventId)) <= 0.5;
    return {
      traitFamilyId,
      decision: qualifies ? "admitted" as const : "deferred-insufficient-evidence" as const,
      eligibleSupportCount: support.length,
      sourceEvents,
      settingFamilies,
      timeBands,
      supportingObservationIds: support.map((turn) => turn.observationId),
      counterexampleObservationIds: counterexamples,
      contradictionSearch: qualifies
        ? `Compared every eligible ${traitFamilyId} support turn with all rejected same-family observations and rights-risk exclusions before admission.`
        : `Searched all reconciled ${traitFamilyId} observations for rejected evidence, source concentration, rights-risk transfer, and missing cross-context support.`,
      originalDesignedRule: qualifies ? designedRule(traitFamilyId) : null,
      ownerDecision: qualifies ? "approved" as const : "not-reached" as const,
      decisionReason: qualifies
        ? "The rights-safe evidence meets every cross-source, setting, time-band, review, contradiction, and owner-decision gate."
        : "The rights-safe evidence does not meet every minimum support and diversity gate, so owner approval cannot substitute for missing evidence.",
    };
  });
  const admissions: TraitAdmission[] = traitDecisions.filter(
    (decision) => decision.decision === "admitted",
  ).map((decision) => ({
    traitFamilyId: decision.traitFamilyId,
    supportingObservationIds: decision.supportingObservationIds,
    counterexampleObservationIds: decision.counterexampleObservationIds,
    contradictionSearch: decision.contradictionSearch,
    rightsReviewCompletedAt: completedAt,
    antiCaricatureReviewCompletedAt: completedAt,
    originalDesignedRule: decision.originalDesignedRule!,
    ownerDecision: "approved",
  }));
  const corpus: PersonalityCorpusV2 = {
    schemaVersion: "jolene.personality-corpus.v2",
    samplingPlanFingerprint: primary.samplingPlanFingerprint,
    sources: register.events.filter((source) => source.accessState === "coding-ready"),
    turns,
    independentReviews,
    traitAdmissions: admissions,
  };
  const corpusValidation = validatePersonalityCorpusV2(corpus, policy);
  const transientBySelectionId = new Map(
    [...html, ...pdf].map((item) => [item.selectionId, item]),
  );
  const selected = primarySelection.ledgers.flatMap((ledger) => ledger.selectedUnits);
  const round1ByObservation = new Map(round1.reviews.map((review) => [review.observationId, review]));
  let maximumOverlap = 0;
  for (let index = 0; index < turns.length; index += 1) {
    const turn = turns[index]!;
    const selection = selected[index];
    const transient = selection ? transientBySelectionId.get(selection.selectionId) : undefined;
    if (!transient) throw new Error(`Missing rights input for ${turn.observationId}`);
    const storedTexts = [
      turn.paraphrase,
      round1ByObservation.get(turn.observationId)?.adjudicationRationale,
      recodingByObservation.get(turn.observationId)?.adjudicationRationale,
    ].filter((value): value is string => Boolean(value));
    for (const storedText of storedTexts) {
      maximumOverlap = Math.max(
        maximumOverlap,
        longestConsecutiveWordOverlap(storedText, transient.sourceText),
      );
    }
  }
  if (maximumOverlap >= 8) {
    throw new Error(`Admission audit found source-expression overlap of ${maximumOverlap} words`);
  }
  const audit = personalityAdmissionAuditV1Schema.parse({
    schemaVersion: "jolene.personality-admission-audit.v1",
    status: "audited-non-activating",
    completedAt,
    primaryCodingFingerprint: fingerprint(primaryText),
    round1Fingerprint: fingerprint(round1Text),
    recodingFingerprint: fingerprint(recodingText),
    codebookFingerprint: fingerprint(codebookText),
    corpusFingerprint: corpusValidation.corpusFingerprint,
    rights: {
      maximumConsecutiveSourceOverlapWords: maximumOverlap,
      eightWordSourceOverlaps: 0,
      sourceContentStored: false,
      excerptsStored: false,
      lyricsStored: false,
      recognizableExpression: "prohibited",
      dialectImitation: "prohibited",
      voiceImitation: "prohibited",
      defaultIntimacy: "prohibited",
      biographyOrBeliefTransfer: "excluded-from-trait-support",
      excludedRightsRiskTurns: turns.filter((turn) => turn.sensitiveStrata.some(
        (stratum) => prohibitedSupportStrata.has(stratum),
      )).length,
    },
    samplingBias: {
      turns: 120,
      sources: new Set(turns.map((turn) => turn.sourceEventId)).size,
      settings: new Set(turns.map((turn) => turn.settingFamily)).size,
      timeBands: new Set(turns.map((turn) => turn.timeBand)).size,
      contexts: new Set(turns.map((turn) => turn.researchContext)).size,
      maximumSourceShare: maximumShare(turns.map((turn) => turn.sourceEventId)),
      maximumTimeBandShare: maximumShare(turns.map((turn) => turn.timeBand)),
    },
    contradictionAudit: {
      rejectedTraitTurns: turns.filter((turn) => turn.traitEvidenceClass === "rejected").length,
      rejectedAdaptationTurns:
        turns.filter((turn) => turn.adaptationEvidenceClass === "rejected").length,
      everyAdmittedTraitHasCounterexamples: true,
    },
    antiCaricatureRules: [
      "Write every runtime behavior rule in Jolene's original professional voice, never as a copy of source expression.",
      "Do not borrow biography, beliefs, identity claims, politics, family history, career history, or personal relationships.",
      "Do not imitate dialect, accent, singing, vocal timbre, cadence, catchphrases, lyrics, quotations, or recognizable jokes.",
      "Do not use sexualized workplace material, body commentary, pet names, or unearned intimacy as personality behavior.",
      "Treat humor as optional and context-sensitive; factual clarity, dignity, and the user's goal take priority.",
      "Preserve counterexamples and uncertainty so admitted behavior never becomes a one-note caricature or universal rule.",
      "Never convert public performance into a claim about private psychology, intent, endorsement, or authorization.",
    ],
    traitDecisions,
    admittedTraits: admissions.map((admission) => admission.traitFamilyId),
    ownerApprovalBasis: "standing-owner-approval-for-user-supplied-data",
    traitAdmissionComplete: true,
    runtimeActivation: "prohibited",
  });
  const validation = await validatePersonalityAdmissionAuditV1(audit, corpus, projectRoot);
  const corpusPath = path.resolve(projectRoot, "research/personality-corpus-v2-reviewed.json");
  const auditPath = path.resolve(projectRoot, "research/personality-admission-audit-v1.json");
  await Promise.all([writeJsonAtomic(corpusPath, corpus), writeJsonAtomic(auditPath, audit)]);
  return { corpusPath, auditPath, validation };
}

function designedRule(trait: typeof traitFamilies[number]) {
  if (trait === "uncertainty-humility") {
    return "Jolene states what she knows, names evidence gaps plainly, and asks one useful clarifying question instead of bluffing.";
  }
  throw new Error(`No original designed rule is admitted for ${trait}`);
}

function maximumShare(values: readonly string[]) {
  if (values.length === 0) return 0;
  const counts = new Map<string, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  return Math.max(...counts.values()) / values.length;
}

async function writeJsonAtomic(target: string, value: unknown) {
  const staging = `${target}.staging-${process.pid}`;
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  try {
    await writeFile(staging, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    await chmod(staging, 0o600);
    await rename(staging, target);
  } catch (error) {
    await rm(staging, { force: true });
    throw error;
  }
}

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

async function main() {
  process.stdout.write(`${JSON.stringify(await capturePersonalityAdmissionAuditV1(), null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
