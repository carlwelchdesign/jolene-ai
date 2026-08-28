import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import {
  categoricalCodingFromTurn,
  independentReviewReasons,
  personalityIndependentReviewV5Schema,
  type PersonalityCategoricalCodingV5,
} from "./personality-independent-review-v5.js";
import { personalityPrimaryCodingArtifactV5Schema } from
  "./personality-primary-coding-v5.js";
import { loadPersonalitySelectionArtifactsV5 } from
  "./personality-selection-ledgers-v5.js";

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const codingSchema = z.object({
  speechAct: z.enum([
    "acknowledge", "advise", "answer", "ask", "boundary", "credit", "joke",
    "reframe", "story",
  ]),
  researchContext: z.enum([
    "attribution", "boundaries", "care", "humor", "leadership", "recovery",
    "uncertainty", "work-practice",
  ]),
  traitFamilyId: z.enum([
    "bounded-warmth", "calibrated-wit", "candid-repair", "credit-aware-authority",
    "disciplined-agency", "grounded-optimism", "operational-care", "uncertainty-humility",
  ]),
  seriousnessPivot: z.boolean(),
}).strict();
const changedFieldSchema = z.enum([
  "researchContext", "seriousnessPivot", "speechAct", "traitFamilyId",
]);
const reviewerSchema = z.object({
  reviewerId: z.string().regex(/^[a-z0-9][a-z0-9-]{2,63}$/u),
  reviewerType: z.enum(["ai", "human"]),
  tool: z.string().min(1),
  modelVersion: z.string().min(1).nullable(),
}).strict();

const codebookSchema = z.object({
  schemaVersion: z.literal("jolene.personality-categorical-codebook.v1"),
  status: z.literal("prospective-frozen-before-recoding"),
  frozenAt: z.string().datetime(),
  reviewProtocol: z.object({
    completeRequiredSet: z.literal(118),
    recoders: z.literal(2),
    blindToPrimaryRound: z.literal(true),
    blindToOtherRecoder: z.literal(true),
    sourceTextPersistence: z.literal("prohibited"),
    minimumRawCategoricalAgreement: z.literal(0.8),
    minimumTraitFamilyKappa: z.literal(0.6),
    preserveRound1: z.literal(true),
  }).passthrough(),
  traitAdmission: z.literal("prohibited"),
  runtimeActivation: z.literal("prohibited"),
}).passthrough();

export const personalityRecodingV1Schema = z.object({
  schemaVersion: z.literal("jolene.personality-recoding.v1"),
  status: z.enum([
    "recoding-passed-awaiting-rights-and-trait-admission-audit",
    "recoding-failed-further-decision-required",
  ]),
  completedAt: z.string().datetime(),
  primaryCodingFingerprint: sha256Schema,
  round1Fingerprint: sha256Schema,
  codebookFingerprint: sha256Schema,
  recoderA: reviewerSchema,
  recoderB: reviewerSchema,
  adjudicator: reviewerSchema,
  rows: z.array(z.object({
    observationId: z.string().regex(/^T\d{3}$/u),
    selectionId: z.string().regex(/^SEL-S\d{2}-\d{4}$/u),
    sourceEventId: z.string().regex(/^E\d{3}$/u),
    reviewReasons: z.array(z.string().min(1)).min(1),
    recoderAAssignedAt: z.string().datetime(),
    recoderACodedAt: z.string().datetime(),
    recoderBAssignedAt: z.string().datetime(),
    recoderBCodedAt: z.string().datetime(),
    reconciledAt: z.string().datetime(),
    recoderA: codingSchema,
    recoderB: codingSchema,
    changedFields: z.array(changedFieldSchema),
    reconciledCoding: codingSchema,
    adjudicationRationale: z.string().min(20).max(500),
  }).strict()).length(118),
  agreement: z.object({
    rawCategoricalAgreement: z.number().min(0).max(1),
    traitFamilyKappa: z.number().min(-1).max(1),
    disagreementRows: z.number().int().nonnegative(),
  }).strict(),
  coverage: z.object({
    turns: z.literal(118),
    sources: z.literal(10),
    researchContexts: z.literal(8),
    sensitiveTurns: z.literal(84),
    lowConfidenceTurns: z.literal(17),
    traitAdmissionCandidateTurns: z.literal(31),
  }).strict(),
  round1Preserved: z.literal(true),
  sourceContentStored: z.literal(false),
  excerptsStored: z.literal(false),
  traitAdmission: z.literal("prohibited"),
  runtimeActivation: z.literal("prohibited"),
}).strict();

export type PersonalityRecodingV1 = z.infer<typeof personalityRecodingV1Schema>;

const prerequisiteCache = new Map<string, Promise<{
  readonly primaryText: string;
  readonly round1Text: string;
  readonly codebookText: string;
  readonly selection: Awaited<ReturnType<typeof loadPersonalitySelectionArtifactsV5>>;
}>>();

async function prerequisites(projectRoot: string) {
  const root = path.resolve(projectRoot);
  const cached = prerequisiteCache.get(root);
  if (cached) return cached;
  const loading = Promise.all([
    readFile(path.resolve(root, "research/primary-coding-v5.json"), "utf8"),
    readFile(path.resolve(root, "research/independent-review-v5.json"), "utf8"),
    readFile(path.resolve(root, "research/personality-categorical-codebook-v1.json"), "utf8"),
    loadPersonalitySelectionArtifactsV5(root),
  ]).then(([primaryText, round1Text, codebookText, selection]) => ({
    primaryText, round1Text, codebookText, selection,
  }));
  prerequisiteCache.set(root, loading);
  return loading;
}

export async function loadPersonalityCategoricalCodebookV1(projectRoot = process.cwd()) {
  const text = await readFile(
    path.resolve(projectRoot, "research/personality-categorical-codebook-v1.json"), "utf8",
  );
  return { codebook: codebookSchema.parse(JSON.parse(text)), fingerprint: digest(text) };
}

export async function validatePersonalityRecodingV1(
  raw: PersonalityRecodingV1,
  projectRoot = process.cwd(),
) {
  const artifact = personalityRecodingV1Schema.parse(raw);
  const { primaryText, round1Text, codebookText, selection } = await prerequisites(projectRoot);
  const primary = personalityPrimaryCodingArtifactV5Schema.parse(JSON.parse(primaryText));
  const round1 = personalityIndependentReviewV5Schema.parse(JSON.parse(round1Text));
  codebookSchema.parse(JSON.parse(codebookText));
  if (artifact.primaryCodingFingerprint !== digest(primaryText) ||
      artifact.round1Fingerprint !== digest(round1Text) ||
      artifact.codebookFingerprint !== digest(codebookText) ||
      round1.status !== "reconciliation-failed-recoding-required") {
    throw new Error("Recoding prerequisite fingerprint or state mismatch");
  }
  const reviewerIds = [
    artifact.recoderA.reviewerId, artifact.recoderB.reviewerId,
    artifact.adjudicator.reviewerId, primary.primaryReviewer.reviewerId,
  ];
  if (new Set(reviewerIds).size !== reviewerIds.length) {
    throw new Error("Recoding reviewer identities are not separated");
  }
  const selected = selection.ledgers.flatMap((ledger) => ledger.selectedUnits);
  const expected = primary.turns.map((turn, index) => ({
    turn,
    selectionId: selected[index]?.selectionId,
    reasons: independentReviewReasons(turn),
  })).filter((item) => item.reasons.length > 0);
  artifact.rows.forEach((row, index) => {
    const item = expected[index];
    if (!item || row.observationId !== item.turn.observationId ||
        row.selectionId !== item.selectionId || row.sourceEventId !== item.turn.sourceEventId ||
        JSON.stringify(row.reviewReasons) !== JSON.stringify(item.reasons)) {
      throw new Error(`Recoding selection drift at row ${index + 1}`);
    }
    const changed = changedFields(row.recoderA, row.recoderB);
    if (JSON.stringify(row.changedFields) !== JSON.stringify(changed)) {
      throw new Error(`Recoding change metadata mismatch at ${row.observationId}`);
    }
    if (Date.parse(row.recoderAAssignedAt) > Date.parse(row.recoderACodedAt) ||
        Date.parse(row.recoderBAssignedAt) > Date.parse(row.recoderBCodedAt) ||
        Math.max(Date.parse(row.recoderACodedAt), Date.parse(row.recoderBCodedAt)) >
          Date.parse(row.reconciledAt)) {
      throw new Error(`Recoding timestamps are out of order at ${row.observationId}`);
    }
  });
  const agreement = calculateRecodingAgreement(artifact.rows);
  const thresholdsMet = agreement.rawCategoricalAgreement >= 0.8 &&
    agreement.traitFamilyKappa >= 0.6;
  const expectedStatus = thresholdsMet
    ? "recoding-passed-awaiting-rights-and-trait-admission-audit"
    : "recoding-failed-further-decision-required";
  if (artifact.status !== expectedStatus ||
      JSON.stringify(artifact.agreement) !== JSON.stringify(agreement)) {
    throw new Error("Recoding status or agreement summary mismatch");
  }
  return {
    ...artifact.coverage,
    ...agreement,
    thresholdsMet,
    artifactFingerprint: digest(`${JSON.stringify(artifact)}\n`),
    sourceContentStored: false as const,
    runtimeActivation: "prohibited" as const,
  };
}

export function calculateRecodingAgreement(rows: readonly PersonalityRecodingV1["rows"][number][]) {
  const fields = changedFieldSchema.options;
  const agreements = rows.reduce((total, row) => total + fields.filter(
    (field) => row.recoderA[field] === row.recoderB[field],
  ).length, 0);
  const categories = codingSchema.shape.traitFamilyId.options;
  const aCounts = new Map<string, number>();
  const bCounts = new Map<string, number>();
  let traitAgreements = 0;
  for (const row of rows) {
    if (row.recoderA.traitFamilyId === row.recoderB.traitFamilyId) traitAgreements += 1;
    aCounts.set(row.recoderA.traitFamilyId, (aCounts.get(row.recoderA.traitFamilyId) ?? 0) + 1);
    bCounts.set(row.recoderB.traitFamilyId, (bCounts.get(row.recoderB.traitFamilyId) ?? 0) + 1);
  }
  const observed = traitAgreements / rows.length;
  const expected = categories.reduce((total, category) => total +
    ((aCounts.get(category) ?? 0) / rows.length) *
    ((bCounts.get(category) ?? 0) / rows.length), 0);
  return {
    rawCategoricalAgreement: agreements / (rows.length * fields.length),
    traitFamilyKappa: expected === 1 ? (observed === 1 ? 1 : 0) :
      (observed - expected) / (1 - expected),
    disagreementRows: rows.filter((row) => row.changedFields.length > 0).length,
  };
}

export function changedFields(
  left: PersonalityCategoricalCodingV5,
  right: PersonalityCategoricalCodingV5,
) {
  return changedFieldSchema.options.filter((field) => left[field] !== right[field]);
}

export function categoricalCodingForRecodingTurn(
  turn: Parameters<typeof categoricalCodingFromTurn>[0],
) {
  return categoricalCodingFromTurn(turn);
}

export function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
