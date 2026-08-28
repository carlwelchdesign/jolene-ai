import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import {
  loadPersonalityCorpusV2Policy,
  validatePersonalityCorpusV2,
  type PersonalityCorpusV2,
} from "./personality-corpus-contract.js";
import { personalityIndependentReviewV5Schema } from
  "./personality-independent-review-v5.js";
import { personalityPrimaryCodingArtifactV5Schema } from
  "./personality-primary-coding-v5.js";
import { personalityRecodingV1Schema } from "./personality-recoding-v1.js";

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const traitSchema = z.enum([
  "bounded-warmth", "calibrated-wit", "candid-repair", "credit-aware-authority",
  "disciplined-agency", "grounded-optimism", "operational-care", "uncertainty-humility",
]);

export const personalityAdmissionAuditV1Schema = z.object({
  schemaVersion: z.literal("jolene.personality-admission-audit.v1"),
  status: z.literal("audited-non-activating"),
  completedAt: z.string().datetime(),
  primaryCodingFingerprint: sha256Schema,
  round1Fingerprint: sha256Schema,
  recodingFingerprint: sha256Schema,
  codebookFingerprint: sha256Schema,
  corpusFingerprint: sha256Schema,
  rights: z.object({
    maximumConsecutiveSourceOverlapWords: z.number().int().nonnegative(),
    eightWordSourceOverlaps: z.literal(0),
    sourceContentStored: z.literal(false),
    excerptsStored: z.literal(false),
    lyricsStored: z.literal(false),
    recognizableExpression: z.literal("prohibited"),
    dialectImitation: z.literal("prohibited"),
    voiceImitation: z.literal("prohibited"),
    defaultIntimacy: z.literal("prohibited"),
    biographyOrBeliefTransfer: z.literal("excluded-from-trait-support"),
    excludedRightsRiskTurns: z.number().int().nonnegative(),
  }).strict(),
  samplingBias: z.object({
    turns: z.literal(120),
    sources: z.literal(10),
    settings: z.literal(8),
    timeBands: z.literal(4),
    contexts: z.literal(8),
    maximumSourceShare: z.number().min(0).max(0.15),
    maximumTimeBandShare: z.number().min(0).max(0.4),
  }).strict(),
  contradictionAudit: z.object({
    rejectedTraitTurns: z.number().int().min(24),
    rejectedAdaptationTurns: z.number().int().min(24),
    everyAdmittedTraitHasCounterexamples: z.literal(true),
  }).strict(),
  antiCaricatureRules: z.array(z.string().min(20)).min(6),
  traitDecisions: z.array(z.object({
    traitFamilyId: traitSchema,
    decision: z.enum(["admitted", "deferred-insufficient-evidence"]),
    eligibleSupportCount: z.number().int().nonnegative(),
    sourceEvents: z.number().int().nonnegative(),
    settingFamilies: z.number().int().nonnegative(),
    timeBands: z.number().int().nonnegative(),
    supportingObservationIds: z.array(z.string().regex(/^T\d{3}$/u)),
    counterexampleObservationIds: z.array(z.string().regex(/^T\d{3}$/u)).min(1),
    contradictionSearch: z.string().min(20),
    originalDesignedRule: z.string().min(20).nullable(),
    ownerDecision: z.enum(["approved", "not-reached"]),
    decisionReason: z.string().min(20),
  }).strict()).length(8),
  admittedTraits: z.array(traitSchema).length(1),
  ownerApprovalBasis: z.literal("standing-owner-approval-for-user-supplied-data"),
  traitAdmissionComplete: z.literal(true),
  runtimeActivation: z.literal("prohibited"),
}).strict();

export type PersonalityAdmissionAuditV1 = z.infer<typeof personalityAdmissionAuditV1Schema>;

export async function validatePersonalityAdmissionAuditV1(
  raw: PersonalityAdmissionAuditV1,
  corpus: PersonalityCorpusV2,
  projectRoot = process.cwd(),
) {
  const audit = personalityAdmissionAuditV1Schema.parse(raw);
  const [primaryText, round1Text, recodingText, codebookText, policy] = await Promise.all([
    readFile(path.resolve(projectRoot, "research/primary-coding-v5.json"), "utf8"),
    readFile(path.resolve(projectRoot, "research/independent-review-v5.json"), "utf8"),
    readFile(path.resolve(projectRoot, "research/personality-recoding-v1.json"), "utf8"),
    readFile(path.resolve(projectRoot, "research/personality-categorical-codebook-v1.json"), "utf8"),
    loadPersonalityCorpusV2Policy(projectRoot),
  ]);
  personalityPrimaryCodingArtifactV5Schema.parse(JSON.parse(primaryText));
  personalityIndependentReviewV5Schema.parse(JSON.parse(round1Text));
  personalityRecodingV1Schema.parse(JSON.parse(recodingText));
  if (audit.primaryCodingFingerprint !== digest(primaryText) ||
      audit.round1Fingerprint !== digest(round1Text) ||
      audit.recodingFingerprint !== digest(recodingText) ||
      audit.codebookFingerprint !== digest(codebookText)) {
    throw new Error("Admission audit prerequisite fingerprint mismatch");
  }
  const corpusValidation = validatePersonalityCorpusV2(corpus, policy);
  if (audit.corpusFingerprint !== corpusValidation.corpusFingerprint) {
    throw new Error("Admission audit corpus fingerprint mismatch");
  }
  const admitted = audit.traitDecisions.filter((decision) => decision.decision === "admitted");
  if (admitted.length !== 1 || admitted[0]?.traitFamilyId !== "uncertainty-humility" ||
      audit.admittedTraits[0] !== "uncertainty-humility") {
    throw new Error("Admission decisions do not match the eligible evidence set");
  }
  for (const decision of audit.traitDecisions) {
    const qualifies = decision.eligibleSupportCount >= 6 && decision.sourceEvents >= 3 &&
      decision.settingFamilies >= 3 && decision.timeBands >= 2;
    if ((decision.decision === "admitted") !== qualifies ||
        (qualifies && (decision.ownerDecision !== "approved" || !decision.originalDesignedRule)) ||
        (!qualifies && (decision.ownerDecision !== "not-reached" || decision.originalDesignedRule))) {
      throw new Error(`Trait decision evidence mismatch for ${decision.traitFamilyId}`);
    }
  }
  return {
    admittedTraits: audit.admittedTraits.length,
    deferredTraits: audit.traitDecisions.length - audit.admittedTraits.length,
    maximumConsecutiveSourceOverlapWords: audit.rights.maximumConsecutiveSourceOverlapWords,
    eightWordSourceOverlaps: 0 as const,
    corpusFingerprint: corpusValidation.corpusFingerprint,
    sourceContentStored: false as const,
    traitAdmissionComplete: true as const,
    runtimeActivation: "prohibited" as const,
  };
}

export function fingerprint(value: string): `sha256:${string}` {
  return digest(value);
}

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
