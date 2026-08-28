import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import {
  personalityPrimaryCodingArtifactV5Schema,
  type PersonalityPrimaryCodingArtifactV5,
} from "./personality-primary-coding-v5.js";
import { loadPersonalitySelectionArtifactsV5 } from
  "./personality-selection-ledgers-v5.js";

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const reviewerIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{2,63}$/u);
const categoricalCodingSchema = z.object({
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
    "disciplined-agency", "grounded-optimism", "operational-care",
    "uncertainty-humility",
  ]),
  seriousnessPivot: z.boolean(),
}).strict();

const changedFieldSchema = z.enum([
  "researchContext", "seriousnessPivot", "speechAct", "traitFamilyId",
]);

const reviewReasonSchema = z.enum([
  "minimum-sample", "sensitive-stratum", "low-confidence", "humor",
  "contradiction", "biography-or-belief", "boundary", "trait-admission-candidate",
]);

const reviewerSchema = z.object({
  reviewerId: reviewerIdSchema,
  reviewerType: z.enum(["ai", "human"]),
  tool: z.string().min(1),
  modelVersion: z.string().min(1).nullable(),
}).strict();

export const personalityIndependentReviewV5Schema = z.object({
  schemaVersion: z.literal("jolene.personality-independent-review.v5"),
  status: z.enum([
    "reconciled-awaiting-rights-and-trait-admission-audit",
    "reconciliation-failed-recoding-required",
  ]),
  reviewedAt: z.string().datetime(),
  primaryCodingFingerprint: sha256Schema,
  selectionManifestFingerprint: sha256Schema,
  independentReviewer: reviewerSchema,
  adjudicator: reviewerSchema,
  reviews: z.array(z.object({
    observationId: z.string().regex(/^T\d{3}$/u),
    selectionId: z.string().regex(/^SEL-S\d{2}-\d{4}$/u),
    sourceEventId: z.string().regex(/^E\d{3}$/u),
    reviewReasons: z.array(reviewReasonSchema).min(1),
    assignedAt: z.string().datetime(),
    codedAt: z.string().datetime(),
    reconciledAt: z.string().datetime(),
    independentAssignmentFingerprint: sha256Schema,
    primaryRawCoding: categoricalCodingSchema,
    rawCoding: categoricalCodingSchema,
    reconciledCoding: categoricalCodingSchema,
    disposition: z.enum(["agree", "adjusted"]),
    changedFields: z.array(changedFieldSchema),
    adjudicationRationale: z.string().min(20).max(500),
  }).strict()).min(30),
  coverage: z.object({
    reviewedTurns: z.number().int().positive(),
    reviewRate: z.number().min(0).max(1),
    sources: z.number().int().positive(),
    researchContexts: z.number().int().positive(),
    sensitiveTurns: z.number().int().nonnegative(),
    lowConfidenceTurns: z.number().int().nonnegative(),
    traitAdmissionCandidateTurns: z.number().int().nonnegative(),
  }).strict(),
  agreement: z.object({
    rawCategoricalAgreement: z.number().min(0).max(1),
    traitFamilyKappa: z.number().min(-1).max(1),
    adjustedReviews: z.number().int().nonnegative(),
  }).strict(),
  thresholds: z.object({
    minimumReviewRate: z.literal(0.25),
    minimumPerSource: z.literal(2),
    minimumPerContext: z.literal(2),
    minimumRawCategoricalAgreement: z.literal(0.8),
    minimumTraitFamilyKappa: z.literal(0.6),
  }).strict(),
  rights: z.object({
    repositoryStorage: z.literal("metadata-and-controlled-coding-only"),
    sourceContentStored: z.literal(false),
    excerptsStored: z.literal(false),
    recognizableExpression: z.literal("prohibited"),
  }).strict(),
  traitAdmission: z.literal("prohibited"),
  runtimeActivation: z.literal("prohibited"),
}).strict();

export type PersonalityIndependentReviewV5 = z.infer<
  typeof personalityIndependentReviewV5Schema
>;
export type PersonalityCategoricalCodingV5 = z.infer<typeof categoricalCodingSchema>;
export type PersonalityReviewReasonV5 = z.infer<typeof reviewReasonSchema>;

export interface PersonalityIndependentReviewValidationV5 {
  readonly reviewedTurns: number;
  readonly reviewRate: number;
  readonly sources: number;
  readonly researchContexts: number;
  readonly rawCategoricalAgreement: number;
  readonly traitFamilyKappa: number;
  readonly adjustedReviews: number;
  readonly thresholdsMet: boolean;
  readonly artifactFingerprint: string;
  readonly sourceContentStored: false;
  readonly runtimeActivation: "prohibited";
}

const prerequisiteCache = new Map<string, Promise<{
  readonly primaryText: string;
  readonly selection: Awaited<ReturnType<typeof loadPersonalitySelectionArtifactsV5>>;
}>>();

function loadIndependentReviewPrerequisites(projectRoot: string) {
  const root = path.resolve(projectRoot);
  const cached = prerequisiteCache.get(root);
  if (cached) return cached;
  const loading = Promise.all([
    readFile(path.resolve(root, "research/primary-coding-v5.json"), "utf8"),
    loadPersonalitySelectionArtifactsV5(root),
  ]).then(([primaryText, selection]) => ({ primaryText, selection }));
  prerequisiteCache.set(root, loading);
  return loading;
}

export function categoricalCodingFromTurn(
  turn: PersonalityPrimaryCodingArtifactV5["turns"][number],
): PersonalityCategoricalCodingV5 {
  return {
    speechAct: turn.speechAct,
    researchContext: turn.researchContext,
    traitFamilyId: turn.traitFamilyId,
    seriousnessPivot: turn.seriousnessPivot,
  };
}

export function independentReviewReasons(
  turn: PersonalityPrimaryCodingArtifactV5["turns"][number],
): readonly PersonalityReviewReasonV5[] {
  const reasons = new Set<PersonalityReviewReasonV5>();
  if (turn.sensitiveStrata.length > 0) reasons.add("sensitive-stratum");
  if (turn.confidence === "low") reasons.add("low-confidence");
  if (turn.researchContext === "humor" || turn.speechAct === "joke" ||
      turn.sensitiveStrata.includes("humor")) reasons.add("humor");
  if (turn.sensitiveStrata.includes("contradiction")) reasons.add("contradiction");
  if (turn.sensitiveStrata.includes("biography") || turn.sensitiveStrata.includes("belief")) {
    reasons.add("biography-or-belief");
  }
  if (turn.researchContext === "boundaries" || turn.speechAct === "boundary" ||
      turn.sensitiveStrata.includes("boundary")) reasons.add("boundary");
  if (turn.traitEvidenceClass === "inferred") reasons.add("trait-admission-candidate");
  return [...reasons];
}

export function changedCategoricalFields(
  primary: PersonalityCategoricalCodingV5,
  secondary: PersonalityCategoricalCodingV5,
) {
  return changedFieldSchema.options.filter((field) => primary[field] !== secondary[field]);
}

export function independentAssignmentFingerprint(input: {
  readonly observationId: string;
  readonly selectionId: string;
  readonly reviewer: PersonalityIndependentReviewV5["independentReviewer"];
  readonly rawCoding: PersonalityCategoricalCodingV5;
}) {
  return digest(JSON.stringify(input));
}

export async function validatePersonalityIndependentReviewV5(
  raw: PersonalityIndependentReviewV5,
  projectRoot = process.cwd(),
): Promise<Omit<PersonalityIndependentReviewValidationV5, "artifactFingerprint">> {
  const artifact = personalityIndependentReviewV5Schema.parse(raw);
  const { primaryText, selection } = await loadIndependentReviewPrerequisites(projectRoot);
  const primary = personalityPrimaryCodingArtifactV5Schema.parse(JSON.parse(primaryText));
  if (artifact.primaryCodingFingerprint !== digest(primaryText) ||
      artifact.selectionManifestFingerprint !== primary.selectionManifestFingerprint ||
      artifact.selectionManifestFingerprint !== selection.manifestFingerprint) {
    throw new Error("Independent review prerequisite fingerprint mismatch");
  }
  if (artifact.independentReviewer.reviewerId === primary.primaryReviewer.reviewerId ||
      artifact.adjudicator.reviewerId === artifact.independentReviewer.reviewerId) {
    throw new Error("Independent review identities are not separated");
  }
  const selectedUnits = selection.ledgers.flatMap((ledger) =>
    ledger.selectedUnits.map((unit) => ({ ledger, unit })));
  const expected = primary.turns.map((turn, index) => ({
    turn,
    selection: selectedUnits[index],
    reasons: independentReviewReasons(turn),
  })).filter((item) => item.reasons.length > 0);
  if (artifact.reviews.length !== expected.length) {
    throw new Error(`Independent review set must contain ${expected.length} turns`);
  }
  const reviewIds = new Set<string>();
  for (let index = 0; index < artifact.reviews.length; index += 1) {
    const review = artifact.reviews[index]!;
    const item = expected[index]!;
    if (reviewIds.has(review.observationId)) throw new Error("Duplicate independent review");
    reviewIds.add(review.observationId);
    if (!item.selection || review.observationId !== item.turn.observationId ||
        review.selectionId !== item.selection.unit.selectionId ||
        review.sourceEventId !== item.turn.sourceEventId ||
        JSON.stringify(review.reviewReasons) !== JSON.stringify(item.reasons)) {
      throw new Error(`Independent review selection drift at ${item.turn.observationId}`);
    }
    const primaryRaw = categoricalCodingFromTurn(item.turn);
    if (JSON.stringify(review.primaryRawCoding) !== JSON.stringify(primaryRaw)) {
      throw new Error(`Primary raw coding mismatch at ${review.observationId}`);
    }
    const changed = changedCategoricalFields(primaryRaw, review.rawCoding);
    if (JSON.stringify(review.changedFields) !== JSON.stringify(changed) ||
        review.disposition !== (changed.length === 0 ? "agree" : "adjusted")) {
      throw new Error(`Reconciliation metadata mismatch at ${review.observationId}`);
    }
    const expectedFingerprint = independentAssignmentFingerprint({
      observationId: review.observationId,
      selectionId: review.selectionId,
      reviewer: artifact.independentReviewer,
      rawCoding: review.rawCoding,
    });
    if (review.independentAssignmentFingerprint !== expectedFingerprint) {
      throw new Error(`Independent assignment fingerprint mismatch at ${review.observationId}`);
    }
    if (Date.parse(review.assignedAt) > Date.parse(review.codedAt) ||
        Date.parse(review.codedAt) > Date.parse(review.reconciledAt)) {
      throw new Error(`Review timestamps are out of order at ${review.observationId}`);
    }
  }
  assertCoverage(primary, artifact.reviews);
  const agreement = rawCategoricalAgreement(artifact.reviews);
  const kappa = traitFamilyKappa(artifact.reviews);
  const adjusted = artifact.reviews.filter((review) => review.disposition === "adjusted").length;
  const coverage = calculateCoverage(primary, artifact.reviews);
  const thresholdsMet = agreement >= artifact.thresholds.minimumRawCategoricalAgreement &&
    kappa >= artifact.thresholds.minimumTraitFamilyKappa;
  const expectedStatus = thresholdsMet
    ? "reconciled-awaiting-rights-and-trait-admission-audit"
    : "reconciliation-failed-recoding-required";
  if (artifact.status !== expectedStatus) {
    throw new Error("Independent review status does not match measured thresholds");
  }
  if (JSON.stringify(artifact.coverage) !== JSON.stringify(coverage) ||
      artifact.agreement.rawCategoricalAgreement !== agreement ||
      artifact.agreement.traitFamilyKappa !== kappa ||
      artifact.agreement.adjustedReviews !== adjusted) {
    throw new Error("Independent review summary does not match raw assignments");
  }
  return {
    ...coverage,
    rawCategoricalAgreement: agreement,
    traitFamilyKappa: kappa,
    adjustedReviews: adjusted,
    thresholdsMet,
    sourceContentStored: false,
    runtimeActivation: "prohibited",
  };
}

export async function loadPersonalityIndependentReviewV5(
  projectRoot = process.cwd(),
  artifactPath = path.resolve(projectRoot, "research/independent-review-v5.json"),
): Promise<PersonalityIndependentReviewValidationV5> {
  const text = await readFile(artifactPath, "utf8");
  const result = await validatePersonalityIndependentReviewV5(
    personalityIndependentReviewV5Schema.parse(JSON.parse(text)), projectRoot,
  );
  return { ...result, artifactFingerprint: digest(text) };
}

export function buildPersonalityIndependentReviewV5(
  input: Omit<PersonalityIndependentReviewV5, "schemaVersion" | "status" | "coverage" |
    "agreement" | "thresholds" | "rights" | "traitAdmission" | "runtimeActivation"> & {
    readonly primary: PersonalityPrimaryCodingArtifactV5;
  },
) {
  const coverage = calculateCoverage(input.primary, input.reviews);
  const rawAgreement = rawCategoricalAgreement(input.reviews);
  const kappa = traitFamilyKappa(input.reviews);
  const thresholdsMet = rawAgreement >= 0.8 && kappa >= 0.6;
  return personalityIndependentReviewV5Schema.parse({
    schemaVersion: "jolene.personality-independent-review.v5",
    status: thresholdsMet
      ? "reconciled-awaiting-rights-and-trait-admission-audit"
      : "reconciliation-failed-recoding-required",
    reviewedAt: input.reviewedAt,
    primaryCodingFingerprint: input.primaryCodingFingerprint,
    selectionManifestFingerprint: input.selectionManifestFingerprint,
    independentReviewer: input.independentReviewer,
    adjudicator: input.adjudicator,
    reviews: input.reviews,
    coverage,
    agreement: {
      rawCategoricalAgreement: rawAgreement,
      traitFamilyKappa: kappa,
      adjustedReviews: input.reviews.filter((review) => review.disposition === "adjusted").length,
    },
    thresholds: {
      minimumReviewRate: 0.25,
      minimumPerSource: 2,
      minimumPerContext: 2,
      minimumRawCategoricalAgreement: 0.8,
      minimumTraitFamilyKappa: 0.6,
    },
    rights: {
      repositoryStorage: "metadata-and-controlled-coding-only",
      sourceContentStored: false,
      excerptsStored: false,
      recognizableExpression: "prohibited",
    },
    traitAdmission: "prohibited",
    runtimeActivation: "prohibited",
  });
}

function calculateCoverage(
  primary: PersonalityPrimaryCodingArtifactV5,
  reviews: readonly PersonalityIndependentReviewV5["reviews"][number][],
) {
  const turnById = new Map(primary.turns.map((turn) => [turn.observationId, turn]));
  const turns = reviews.map((review) => turnById.get(review.observationId)!);
  return {
    reviewedTurns: reviews.length,
    reviewRate: reviews.length / primary.turns.length,
    sources: new Set(turns.map((turn) => turn.sourceEventId)).size,
    researchContexts: new Set(turns.map((turn) => turn.researchContext)).size,
    sensitiveTurns: turns.filter((turn) => turn.sensitiveStrata.length > 0).length,
    lowConfidenceTurns: turns.filter((turn) => turn.confidence === "low").length,
    traitAdmissionCandidateTurns:
      turns.filter((turn) => turn.traitEvidenceClass === "inferred").length,
  };
}

function assertCoverage(
  primary: PersonalityPrimaryCodingArtifactV5,
  reviews: readonly PersonalityIndependentReviewV5["reviews"][number][],
) {
  if (reviews.length < Math.ceil(primary.turns.length * 0.25)) {
    throw new Error("Independent review rate is below 25 percent");
  }
  const reviewed = new Set(reviews.map((review) => review.observationId));
  for (const source of new Set(primary.turns.map((turn) => turn.sourceEventId))) {
    if (primary.turns.filter((turn) => turn.sourceEventId === source &&
        reviewed.has(turn.observationId)).length < 2) {
      throw new Error(`Independent review source coverage is insufficient for ${source}`);
    }
  }
  for (const context of new Set(primary.turns.map((turn) => turn.researchContext))) {
    if (primary.turns.filter((turn) => turn.researchContext === context &&
        reviewed.has(turn.observationId)).length < 2) {
      throw new Error(`Independent review context coverage is insufficient for ${context}`);
    }
  }
}

function rawCategoricalAgreement(
  reviews: readonly PersonalityIndependentReviewV5["reviews"][number][],
) {
  const fields = changedFieldSchema.options;
  const agreements = reviews.reduce((total, review) => total + fields.filter(
    (field) => review.primaryRawCoding[field] === review.rawCoding[field],
  ).length, 0);
  return agreements / (reviews.length * fields.length);
}

function traitFamilyKappa(
  reviews: readonly PersonalityIndependentReviewV5["reviews"][number][],
) {
  const categories = categoricalCodingSchema.shape.traitFamilyId.options;
  const primary = new Map<string, number>();
  const secondary = new Map<string, number>();
  let observed = 0;
  for (const review of reviews) {
    const left = review.primaryRawCoding.traitFamilyId;
    const right = review.rawCoding.traitFamilyId;
    if (left === right) observed += 1;
    primary.set(left, (primary.get(left) ?? 0) + 1);
    secondary.set(right, (secondary.get(right) ?? 0) + 1);
  }
  const observedAgreement = observed / reviews.length;
  const expectedAgreement = categories.reduce((total, category) => total +
    ((primary.get(category) ?? 0) / reviews.length) *
    ((secondary.get(category) ?? 0) / reviews.length), 0);
  return expectedAgreement === 1 ? (observedAgreement === 1 ? 1 : 0) :
    (observedAgreement - expectedAgreement) / (1 - expectedAgreement);
}

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
