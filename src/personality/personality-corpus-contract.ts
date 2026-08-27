import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { parse } from "yaml";
import { z } from "zod";

import {
  personalitySourceEventSchema,
  settingFamilySchema,
  timeBandSchema,
} from "./personality-source-register.js";
import type { PersonalitySourceEvent } from "./personality-source-register.js";

export {
  personalitySourceEventSchema,
  settingFamilySchema,
  timeBandSchema,
} from "./personality-source-register.js";
export type { PersonalitySourceEvent } from "./personality-source-register.js";

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const reviewerIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{2,63}$/);

export const researchContextSchema = z.enum([
  "attribution", "boundaries", "care", "humor", "leadership", "recovery",
  "uncertainty", "work-practice",
]);
export const traitFamilySchema = z.enum([
  "bounded-warmth", "calibrated-wit", "candid-repair", "credit-aware-authority",
  "disciplined-agency", "grounded-optimism", "operational-care",
  "uncertainty-humility",
]);
const sensitiveStratumSchema = z.enum([
  "belief", "biography", "boundary", "contradiction", "grief-or-hurt", "humor",
  "identity-trait", "politics", "voice-adjacent", "workplace-sexual-boundary",
]);

const categoricalCodingSchema = z.object({
  speechAct: z.enum([
    "acknowledge", "advise", "answer", "ask", "boundary", "credit", "joke",
    "reframe", "story",
  ]),
  researchContext: researchContextSchema,
  traitFamilyId: traitFamilySchema,
  seriousnessPivot: z.boolean(),
});

export const personalityTurnSchema = categoricalCodingSchema.extend({
  observationId: z.string().regex(/^T\d{3}$/),
  sourceEventId: z.string().regex(/^E\d{3}$/),
  sourceUrl: z.string().url(),
  date: z.string().regex(/^\d{4}(?:-\d{2}-\d{2})?$/),
  timeBand: timeBandSchema,
  settingFamily: settingFamilySchema,
  locator: z.object({
    kind: z.enum(["lines", "page", "section", "timestamp"]),
    start: z.number().nonnegative(),
    end: z.number().nonnegative(),
    label: z.string().min(1),
  }).refine((locator) => locator.end >= locator.start, "Locator end precedes start"),
  atomicSpeakerTurn: z.literal(true),
  excerpt: z.null(),
  paraphrase: z.string().min(20),
  segmentFingerprint: sha256Schema,
  sampleRuleId: z.string().regex(/^SAM-\d{3}$/),
  observationEvidenceClass: z.literal("observed"),
  traitEvidenceClass: z.enum(["inferred", "rejected"]),
  adaptationEvidenceClass: z.enum(["designed", "rejected"]),
  confidence: z.enum(["high", "low", "medium"]),
  sensitiveStrata: z.array(sensitiveStratumSchema),
  alternativeInterpretation: z.string().min(1),
  doNotCopy: z.string().min(1),
  primaryReviewer: z.object({
    reviewerId: reviewerIdSchema,
    reviewerType: z.enum(["ai", "human"]),
    tool: z.string().min(1),
    modelVersion: z.string().min(1).nullable(),
    codedAt: z.string().datetime(),
  }),
});

export const independentReviewSchema = z.object({
  observationId: z.string().regex(/^T\d{3}$/),
  independentAssignmentFingerprint: sha256Schema,
  reviewerId: reviewerIdSchema,
  reviewerType: z.enum(["ai", "human"]),
  tool: z.string().min(1),
  modelVersion: z.string().min(1).nullable(),
  assignedAt: z.string().datetime(),
  codedAt: z.string().datetime(),
  primaryRawCoding: categoricalCodingSchema,
  rawCoding: categoricalCodingSchema,
  reconciledAt: z.string().datetime(),
  adjudicatorId: reviewerIdSchema,
  disposition: z.enum(["agree", "adjusted", "rejected"]),
  changedFields: z.array(z.enum([
    "researchContext", "seriousnessPivot", "speechAct", "traitFamilyId",
  ])),
}).superRefine((review, context) => {
  if (review.disposition === "agree" && review.changedFields.length > 0) {
    context.addIssue({ code: "custom", message: "Agree review cannot change fields" });
  }
  if (review.disposition === "adjusted" && review.changedFields.length === 0) {
    context.addIssue({ code: "custom", message: "Adjusted review must name changed fields" });
  }
  if (Date.parse(review.assignedAt) > Date.parse(review.codedAt) ||
      Date.parse(review.codedAt) > Date.parse(review.reconciledAt)) {
    context.addIssue({ code: "custom", message: "Review timestamps are out of order" });
  }
});

export const traitAdmissionSchema = z.object({
  traitFamilyId: traitFamilySchema,
  supportingObservationIds: z.array(z.string().regex(/^T\d{3}$/)).min(6),
  counterexampleObservationIds: z.array(z.string().regex(/^T\d{3}$/)).min(1),
  contradictionSearch: z.string().min(20),
  rightsReviewCompletedAt: z.string().datetime(),
  antiCaricatureReviewCompletedAt: z.string().datetime(),
  originalDesignedRule: z.string().min(20),
  ownerDecision: z.enum(["approved", "pending", "rejected"]),
});

const policySchema = z.object({
  schema_version: z.literal("personality-corpus-v2"),
  status: z.literal("contract-only"),
  runtime_activation: z.literal("prohibited"),
  eligibility: z.object({
    minimum_atomic_turns: z.literal(100), maximum_atomic_turns: z.literal(150),
    minimum_source_events: z.literal(10), minimum_publisher_families: z.literal(8),
    minimum_setting_families: z.literal(8), minimum_research_contexts: z.literal(8),
    minimum_time_bands: z.literal(4), minimum_turns_per_context: z.literal(5),
    minimum_sources_per_context: z.literal(2),
  }),
  distribution_caps: z.object({
    maximum_source_share: z.literal(0.15), maximum_publisher_share: z.literal(0.2),
    maximum_time_band_share: z.literal(0.4),
  }),
  independent_review: z.object({
    minimum_rate: z.literal(0.25), minimum_per_source: z.literal(2),
    minimum_per_context: z.literal(2), sensitive_strata_rate: z.literal(1),
    low_confidence_rate: z.literal(1), minimum_raw_categorical_agreement: z.literal(0.8),
    minimum_trait_family_kappa: z.literal(0.6),
  }),
  trait_admission: z.object({
    minimum_supporting_turns: z.literal(6), minimum_source_events: z.literal(3),
    minimum_setting_families: z.literal(3), minimum_time_bands: z.literal(2),
    maximum_single_source_share: z.literal(0.5), independent_review_rate: z.literal(1),
  }),
  rights: z.object({
    repository_storage: z.literal("metadata-and-paraphrase-only"),
    excerpts: z.literal("prohibited"), lyrics: z.literal("prohibited"),
    transcript_audio_video_storage: z.literal("prohibited"),
    recognizable_expression: z.literal("prohibited"),
    biography_or_belief_transfer: z.literal("prohibited"),
    dialect_imitation: z.literal("prohibited"), default_intimacy: z.literal("prohibited"),
    voice_imitation: z.literal("prohibited"), snapshot_is_non_activating: z.literal(true),
  }),
});

export type PersonalityTurn = z.infer<typeof personalityTurnSchema>;
export type IndependentReview = z.infer<typeof independentReviewSchema>;
export type TraitAdmission = z.infer<typeof traitAdmissionSchema>;
export type PersonalityCorpusPolicy = z.infer<typeof policySchema>;

export interface PersonalityCorpusV2 {
  readonly schemaVersion: "jolene.personality-corpus.v2";
  readonly samplingPlanFingerprint: string;
  readonly sources: readonly PersonalitySourceEvent[];
  readonly turns: readonly PersonalityTurn[];
  readonly independentReviews: readonly IndependentReview[];
  readonly traitAdmissions: readonly TraitAdmission[];
}

export interface PersonalityCorpusValidation {
  readonly eligibleTurns: number;
  readonly sourceEvents: number;
  readonly publisherFamilies: number;
  readonly settingFamilies: number;
  readonly researchContexts: number;
  readonly timeBands: number;
  readonly independentReviews: number;
  readonly rawCategoricalAgreement: number;
  readonly traitFamilyKappa: number;
  readonly corpusFingerprint: string;
  readonly runtimeActivation: "prohibited";
}

export async function loadPersonalityCorpusV2Policy(
  projectRoot = process.cwd(),
): Promise<PersonalityCorpusPolicy> {
  const text = await readFile(
    path.resolve(projectRoot, "research", "coding-schema-v2.yaml"), "utf8",
  );
  return policySchema.parse(parse(text));
}

export function validatePersonalityCorpusV2(
  input: PersonalityCorpusV2,
  policy: PersonalityCorpusPolicy,
): PersonalityCorpusValidation {
  policySchema.parse(policy);
  if (input.schemaVersion !== "jolene.personality-corpus.v2") {
    throw new Error("Unsupported personality corpus schema");
  }
  sha256Schema.parse(input.samplingPlanFingerprint);
  const sources = input.sources.map((source) => personalitySourceEventSchema.parse(source));
  const turns = input.turns.map((turn) => personalityTurnSchema.parse(turn));
  const reviews = input.independentReviews.map((review) => independentReviewSchema.parse(review));
  const admissions = input.traitAdmissions.map((admission) => traitAdmissionSchema.parse(admission));
  assertUnique(sources.map((source) => source.sourceEventId), "source event");
  assertUnique(sources.map((source) => source.sourceRegisterId), "source register ID");
  assertUnique(sources.map((source) => source.url), "source URL");
  assertUnique(
    sources.flatMap((source) => source.sourceContentFingerprint ?? []),
    "source content fingerprint",
  );
  assertUnique(turns.map((turn) => turn.observationId), "observation");
  assertUnique(turns.map((turn) => turn.segmentFingerprint), "segment fingerprint");
  assertUnique(turns.map((turn) => normalizeParaphrase(turn.paraphrase)), "normalized paraphrase");
  assertUnique(reviews.map((review) => review.observationId), "independent review");
  assertNoLocatorOverlap(turns);

  const sourceById = new Map(sources.map((source) => [source.sourceEventId, source]));
  const turnById = new Map(turns.map((turn) => [turn.observationId, turn]));
  for (const turn of turns) {
    const source = sourceById.get(turn.sourceEventId);
    if (!source || source.accessState !== "coding-ready") {
      throw new Error(`Observation ${turn.observationId} lacks a coding-ready source`);
    }
    if (turn.sourceUrl !== source.url || turn.date !== source.date ||
        turn.timeBand !== source.timeBand || turn.settingFamily !== source.settingFamily) {
      throw new Error(`Observation/source provenance mismatch for ${turn.observationId}`);
    }
  }
  for (const review of reviews) {
    const turn = turnById.get(review.observationId);
    if (!turn) throw new Error(`Review references unknown observation ${review.observationId}`);
    if (turn.primaryReviewer.reviewerId === review.reviewerId) {
      throw new Error(`Independent reviewer matches primary reviewer for ${review.observationId}`);
    }
  }

  assertCountBetween(turns.length, policy.eligibility.minimum_atomic_turns,
    policy.eligibility.maximum_atomic_turns, "eligible atomic turns");
  const sourceIds = new Set(turns.map((turn) => turn.sourceEventId));
  const codedSources = [...sourceIds].map((id) => sourceById.get(id)!);
  assertMinimum(sourceIds.size, policy.eligibility.minimum_source_events, "source events");
  assertMinimum(new Set(codedSources.map((source) => source.publisherFamilyId)).size,
    policy.eligibility.minimum_publisher_families, "publisher families");
  assertMinimum(new Set(turns.map((turn) => turn.settingFamily)).size,
    policy.eligibility.minimum_setting_families, "setting families");
  assertMinimum(new Set(turns.map((turn) => turn.researchContext)).size,
    policy.eligibility.minimum_research_contexts, "research contexts");
  assertMinimum(new Set(turns.map((turn) => turn.timeBand)).size,
    policy.eligibility.minimum_time_bands, "time bands");
  assertContextCoverage(turns, policy);
  assertShare(turns.map((turn) => turn.sourceEventId), policy.distribution_caps.maximum_source_share,
    "source event");
  assertShare(turns.map((turn) => sourceById.get(turn.sourceEventId)!.publisherFamilyId),
    policy.distribution_caps.maximum_publisher_share, "publisher family");
  assertShare(turns.map((turn) => turn.timeBand), policy.distribution_caps.maximum_time_band_share,
    "time band");
  assertReviewCoverage(turns, reviews, policy);
  const agreement = categoricalAgreement(turns, reviews);
  if (agreement < policy.independent_review.minimum_raw_categorical_agreement) {
    throw new Error("Raw categorical agreement is below threshold");
  }
  const kappa = traitFamilyKappa(turns, reviews);
  if (kappa < policy.independent_review.minimum_trait_family_kappa) {
    throw new Error("Trait-family kappa is below threshold");
  }
  validateAdmissions(admissions, turns, reviews, policy);
  return {
    eligibleTurns: turns.length,
    sourceEvents: sourceIds.size,
    publisherFamilies: new Set(codedSources.map((source) => source.publisherFamilyId)).size,
    settingFamilies: new Set(turns.map((turn) => turn.settingFamily)).size,
    researchContexts: new Set(turns.map((turn) => turn.researchContext)).size,
    timeBands: new Set(turns.map((turn) => turn.timeBand)).size,
    independentReviews: reviews.length,
    rawCategoricalAgreement: agreement,
    traitFamilyKappa: kappa,
    corpusFingerprint: fingerprint({ ...input, sources, turns, independentReviews: reviews,
      traitAdmissions: admissions }),
    runtimeActivation: policy.runtime_activation,
  };
}

function assertContextCoverage(turns: readonly PersonalityTurn[], policy: PersonalityCorpusPolicy) {
  for (const context of researchContextSchema.options) {
    const matching = turns.filter((turn) => turn.researchContext === context);
    assertMinimum(matching.length, policy.eligibility.minimum_turns_per_context,
      `turns for context ${context}`);
    assertMinimum(new Set(matching.map((turn) => turn.sourceEventId)).size,
      policy.eligibility.minimum_sources_per_context, `sources for context ${context}`);
  }
}

function assertReviewCoverage(
  turns: readonly PersonalityTurn[], reviews: readonly IndependentReview[],
  policy: PersonalityCorpusPolicy,
) {
  const reviewed = new Set(reviews.map((review) => review.observationId));
  assertMinimum(reviewed.size, Math.ceil(turns.length * policy.independent_review.minimum_rate),
    "independent reviews");
  for (const sourceId of new Set(turns.map((turn) => turn.sourceEventId))) {
    assertMinimum(turns.filter((turn) => turn.sourceEventId === sourceId && reviewed.has(turn.observationId)).length,
      policy.independent_review.minimum_per_source, `reviews for source ${sourceId}`);
  }
  for (const context of researchContextSchema.options) {
    assertMinimum(turns.filter((turn) => turn.researchContext === context && reviewed.has(turn.observationId)).length,
      policy.independent_review.minimum_per_context, `reviews for context ${context}`);
  }
  for (const turn of turns) {
    if ((turn.confidence === "low" || turn.sensitiveStrata.length > 0) && !reviewed.has(turn.observationId)) {
      throw new Error(`Mandatory independent review missing for ${turn.observationId}`);
    }
  }
}

function categoricalAgreement(_turns: readonly PersonalityTurn[], reviews: readonly IndependentReview[]) {
  let agreements = 0;
  let comparisons = 0;
  for (const review of reviews) {
    const fields = ["speechAct", "researchContext", "traitFamilyId", "seriousnessPivot"] as const;
    for (const field of fields) {
      comparisons += 1;
      if (review.primaryRawCoding[field] === review.rawCoding[field]) agreements += 1;
    }
  }
  return comparisons === 0 ? 0 : agreements / comparisons;
}

function traitFamilyKappa(_turns: readonly PersonalityTurn[], reviews: readonly IndependentReview[]) {
  if (reviews.length === 0) return 0;
  const primaryCounts = new Map<string, number>();
  const secondaryCounts = new Map<string, number>();
  let observed = 0;
  for (const review of reviews) {
    const primary = review.primaryRawCoding.traitFamilyId;
    const secondary = review.rawCoding.traitFamilyId;
    if (primary === secondary) observed += 1;
    primaryCounts.set(primary, (primaryCounts.get(primary) ?? 0) + 1);
    secondaryCounts.set(secondary, (secondaryCounts.get(secondary) ?? 0) + 1);
  }
  const observedAgreement = observed / reviews.length;
  const expectedAgreement = traitFamilySchema.options.reduce((total, category) =>
    total + ((primaryCounts.get(category) ?? 0) / reviews.length) *
      ((secondaryCounts.get(category) ?? 0) / reviews.length), 0);
  return expectedAgreement === 1 ? (observedAgreement === 1 ? 1 : 0) :
    (observedAgreement - expectedAgreement) / (1 - expectedAgreement);
}

function validateAdmissions(
  admissions: readonly TraitAdmission[], turns: readonly PersonalityTurn[],
  reviews: readonly IndependentReview[], policy: PersonalityCorpusPolicy,
) {
  const turnById = new Map(turns.map((turn) => [turn.observationId, turn]));
  const reviewed = new Set(reviews.map((review) => review.observationId));
  assertUnique(admissions.map((admission) => admission.traitFamilyId), "trait admission");
  for (const admission of admissions) {
    const support = admission.supportingObservationIds.map((id) => {
      const turn = turnById.get(id);
      if (!turn || turn.traitFamilyId !== admission.traitFamilyId) {
        throw new Error(`Invalid support ${id} for trait ${admission.traitFamilyId}`);
      }
      return turn;
    });
    assertMinimum(support.length, policy.trait_admission.minimum_supporting_turns,
      `support for trait ${admission.traitFamilyId}`);
    assertMinimum(new Set(support.map((turn) => turn.sourceEventId)).size,
      policy.trait_admission.minimum_source_events, "trait source events");
    assertMinimum(new Set(support.map((turn) => turn.settingFamily)).size,
      policy.trait_admission.minimum_setting_families, "trait setting families");
    assertMinimum(new Set(support.map((turn) => turn.timeBand)).size,
      policy.trait_admission.minimum_time_bands, "trait time bands");
    assertShare(support.map((turn) => turn.sourceEventId),
      policy.trait_admission.maximum_single_source_share, "trait source event");
    if (support.some((turn) => !reviewed.has(turn.observationId))) {
      throw new Error(`Trait admission ${admission.traitFamilyId} lacks full independent review`);
    }
    for (const id of admission.counterexampleObservationIds) {
      if (!turnById.has(id)) throw new Error(`Unknown counterexample observation ${id}`);
      if (admission.supportingObservationIds.includes(id)) {
        throw new Error(`Counterexample ${id} is also listed as trait support`);
      }
    }
  }
}

function assertShare(values: readonly string[], maximum: number, label: string) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const largest = Math.max(...counts.values()) / values.length;
  if (largest > maximum) throw new Error(`Maximum ${label} share exceeded`);
}

function assertNoLocatorOverlap(turns: readonly PersonalityTurn[]) {
  const groups = new Map<string, PersonalityTurn[]>();
  for (const turn of turns) {
    const key = `${turn.sourceEventId}:${turn.locator.kind}`;
    groups.set(key, [...(groups.get(key) ?? []), turn]);
  }
  for (const [key, group] of groups) {
    const sorted = [...group].sort((left, right) => left.locator.start - right.locator.start);
    for (let index = 1; index < sorted.length; index += 1) {
      if (sorted[index]!.locator.start <= sorted[index - 1]!.locator.end) {
        throw new Error(`Overlapping personality locators in ${key}`);
      }
    }
  }
}

function assertMinimum(actual: number, minimum: number, label: string) {
  if (actual < minimum) throw new Error(`Too few ${label}: ${actual} < ${minimum}`);
}

function assertCountBetween(actual: number, minimum: number, maximum: number, label: string) {
  if (actual < minimum || actual > maximum) {
    throw new Error(`Invalid ${label}: ${actual} is outside ${minimum}-${maximum}`);
  }
}

function assertUnique(values: readonly string[], label: string) {
  if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label}`);
}

function fingerprint(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function normalizeParaphrase(value: string) {
  return value.toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, " ").trim();
}
