import { createHash } from "node:crypto";

import { z } from "zod";

import type { loadPersonalitySamplingBoundaryProtocolV1 } from
  "./personality-sampling-boundary-protocol.js";
import type { loadPersonalitySourceRegisterV3 } from "./personality-source-register-v3.js";

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const sourceIdSchema = z.string().regex(/^S\d{2}$/);
const eventIdSchema = z.string().regex(/^E\d{3}$/);
const reviewerSchema = z.object({
  reviewerId: z.string().regex(/^[a-z0-9][a-z0-9-]{2,63}$/),
  reviewerType: z.enum(["ai", "human"]),
  tool: z.string().min(1),
  modelVersion: z.string().min(1).nullable(),
  reviewedAt: z.string().datetime(),
}).strict();
const highRiskSchema = z.enum([
  "belief", "biography", "boundary", "contradiction", "grief-or-hurt", "humor",
  "identity-trait", "politics", "voice-adjacent", "workplace-sexual-boundary",
]);
const exclusionReasonSchema = z.enum([
  "advertisement-or-promotion", "duplicate-or-overlap", "interviewer-or-other-speaker",
  "lyric-or-performance", "non-verbal", "not-atomic", "speaker-attribution-unclear",
  "too-fragmentary", "unreviewable-boundary",
]);
const segmentationRuleSchema = z.enum([
  "cnn-speaker-label-blocks-v1", "interview-speaker-label-blocks-v1",
  "paragraph-speaker-blocks-v1", "pdf-attributed-statement-blocks-v2",
  "pdf-speaker-label-blocks-v2", "vanity-proust-answer-pairs-v1",
]);
const locatorSchema = z.object({
  kind: z.enum(["paragraph-index", "section-index", "speaker-block-index", "pair-index"]),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  label: z.string().regex(/^(?:paragraph|section|speaker-block|pair)-\d+(?:-\d+)?$/),
}).strict().refine((locator) => locator.end >= locator.start, "Capacity locator is reversed");

const eligibleUnitSchema = z.object({
  unitId: z.string().regex(/^C-S\d{2}-\d{4}$/),
  sourceUnitOrdinal: z.number().int().nonnegative(),
  locator: locatorSchema,
  segmentFingerprint: sha256Schema,
  primaryEligibility: z.literal("eligible"),
  independentEligibility: z.literal("eligible"),
  primaryHighRiskStrata: z.array(highRiskSchema),
  independentHighRiskStrata: z.array(highRiskSchema),
  agreedHighRiskStrata: z.array(highRiskSchema),
}).strict();

const excludedRangeSchema = z.object({
  exclusionId: z.string().regex(/^CX-S\d{2}-\d{4}$/),
  sourceUnitStart: z.number().int().nonnegative(),
  sourceUnitEnd: z.number().int().nonnegative(),
  locator: locatorSchema,
  segmentFingerprint: sha256Schema,
  primaryReason: exclusionReasonSchema,
  independentReason: exclusionReasonSchema,
  agreedReason: exclusionReasonSchema,
}).strict().refine((unit) => unit.sourceUnitEnd >= unit.sourceUnitStart,
  "Capacity exclusion range is reversed");

export const preallocationCapacityLedgerSchema = z.object({
  schemaVersion: z.literal("jolene.personality-preallocation-capacity-ledger.v1"),
  status: z.literal("independently-reviewed-before-allocation"),
  sourceRegisterFingerprint: sha256Schema,
  boundaryProtocolFingerprint: sha256Schema,
  highRiskTaxonomyFingerprint: sha256Schema,
  sourceRegisterId: sourceIdSchema,
  sourceEventId: eventIdSchema,
  sourceContentFingerprint: sha256Schema,
  segmentationRule: segmentationRuleSchema,
  sourceBoundaryUnitCount: z.number().int().positive(),
  frozenAt: z.string().datetime(),
  primaryReviewer: reviewerSchema,
  independentReviewer: reviewerSchema,
  eligibleUnits: z.array(eligibleUnitSchema),
  excludedRanges: z.array(excludedRangeSchema),
  sourceContentStored: z.literal(false),
  frozenBeforeAllocation: z.literal(true),
  selectionPerformed: z.literal(false),
}).strict();

export type PreallocationCapacityLedger = z.infer<typeof preallocationCapacityLedgerSchema>;
type RegisterV3 = Awaited<ReturnType<typeof loadPersonalitySourceRegisterV3>>;
type BoundaryProtocol = Awaited<ReturnType<typeof loadPersonalitySamplingBoundaryProtocolV1>>;

const expectedRules: Readonly<Record<string, z.infer<typeof segmentationRuleSchema>>> = {
  S02: "paragraph-speaker-blocks-v1", S03: "cnn-speaker-label-blocks-v1",
  S04: "pdf-speaker-label-blocks-v2", S05: "paragraph-speaker-blocks-v1",
  S08: "pdf-speaker-label-blocks-v2", S09: "pdf-speaker-label-blocks-v2",
  S13: "paragraph-speaker-blocks-v1", S18: "pdf-attributed-statement-blocks-v2",
  S19: "interview-speaker-label-blocks-v1", S20: "vanity-proust-answer-pairs-v1",
};
const expectedLocatorKinds: Readonly<Record<string, z.infer<typeof locatorSchema>["kind"]>> = {
  S02: "paragraph-index", S03: "speaker-block-index", S04: "speaker-block-index",
  S05: "paragraph-index", S08: "speaker-block-index", S09: "speaker-block-index",
  S13: "paragraph-index", S18: "paragraph-index", S19: "speaker-block-index",
  S20: "pair-index",
};

export function validatePreallocationCapacityLedger(
  register: RegisterV3,
  protocol: BoundaryProtocol,
  input: unknown,
) {
  const ledger = preallocationCapacityLedgerSchema.parse(input);
  if (ledger.sourceRegisterFingerprint !== register.registerFingerprint ||
      ledger.boundaryProtocolFingerprint !== protocol.protocolFingerprint ||
      ledger.highRiskTaxonomyFingerprint !== protocol.highRiskTaxonomyFingerprint) {
    throw new Error(`${ledger.sourceRegisterId} capacity-ledger prerequisites are stale`);
  }
  const source = register.events.find(
    (candidate) => candidate.sourceRegisterId === ledger.sourceRegisterId,
  );
  if (!source || source.accessState !== "coding-ready" ||
      source.sourceEventId !== ledger.sourceEventId ||
      source.sourceContentFingerprint !== ledger.sourceContentFingerprint) {
    throw new Error(`${ledger.sourceRegisterId} capacity-ledger source provenance mismatch`);
  }
  if (expectedRules[ledger.sourceRegisterId] !== ledger.segmentationRule) {
    throw new Error(`${ledger.sourceRegisterId} capacity-ledger segmentation rule mismatch`);
  }
  if (ledger.primaryReviewer.reviewerId === ledger.independentReviewer.reviewerId) {
    throw new Error(`${ledger.sourceRegisterId} capacity reviewers are not independent`);
  }
  const prerequisiteTime = Math.max(
    Date.parse(register.reviewedAt), Date.parse(protocol.createdAt),
  );
  if (Date.parse(ledger.primaryReviewer.reviewedAt) < prerequisiteTime ||
      Date.parse(ledger.independentReviewer.reviewedAt) < prerequisiteTime ||
      Date.parse(ledger.frozenAt) < Date.parse(ledger.primaryReviewer.reviewedAt) ||
      Date.parse(ledger.frozenAt) < Date.parse(ledger.independentReviewer.reviewedAt)) {
    throw new Error(`${ledger.sourceRegisterId} capacity-ledger chronology is invalid`);
  }
  const expectedLocatorKind = expectedLocatorKinds[ledger.sourceRegisterId];
  if (!expectedLocatorKind || ledger.eligibleUnits.some(
    (unit) => unit.locator.kind !== expectedLocatorKind,
  ) || ledger.excludedRanges.some((range) => range.locator.kind !== expectedLocatorKind)) {
    throw new Error(`${ledger.sourceRegisterId} capacity-ledger locator kind mismatch`);
  }
  for (const unit of ledger.eligibleUnits) {
    if (!unit.unitId.startsWith(`C-${ledger.sourceRegisterId}-`)) {
      throw new Error(`${ledger.sourceRegisterId} capacity unit ID prefix mismatch`);
    }
    assertUnique(unit.primaryHighRiskStrata, `${unit.unitId} primary high-risk stratum`);
    assertUnique(unit.independentHighRiskStrata, `${unit.unitId} independent high-risk stratum`);
    assertUnique(unit.agreedHighRiskStrata, `${unit.unitId} agreed high-risk stratum`);
    const consensus = unit.primaryHighRiskStrata.filter(
      (stratum) => unit.independentHighRiskStrata.includes(stratum),
    ).sort();
    if (JSON.stringify([...unit.agreedHighRiskStrata].sort()) !== JSON.stringify(consensus)) {
      throw new Error(`${unit.unitId} agreed high-risk strata are not reviewer consensus`);
    }
  }
  for (const range of ledger.excludedRanges) {
    if (!range.exclusionId.startsWith(`CX-${ledger.sourceRegisterId}-`) ||
        range.primaryReason !== range.independentReason ||
        range.agreedReason !== range.primaryReason) {
      throw new Error(`${ledger.sourceRegisterId} exclusion lacks independent agreement`);
    }
  }
  assertUnique(ledger.eligibleUnits.map((unit) => unit.unitId), "capacity unit ID");
  assertUnique(ledger.excludedRanges.map((unit) => unit.exclusionId), "capacity exclusion ID");
  assertUnique([
    ...ledger.eligibleUnits.map((unit) => unit.segmentFingerprint),
    ...ledger.excludedRanges.map((unit) => unit.segmentFingerprint),
  ], "capacity segment fingerprint");
  assertCompleteCoverage(ledger);
  return {
    sourceRegisterId: ledger.sourceRegisterId,
    sourceEventId: ledger.sourceEventId,
    boundaryUnits: ledger.sourceBoundaryUnitCount,
    eligibleUnits: ledger.eligibleUnits.length,
    excludedRanges: ledger.excludedRanges.length,
    agreedHighRiskUnits: ledger.eligibleUnits.filter(
      (unit) => unit.agreedHighRiskStrata.length > 0,
    ).length,
    ledgerFingerprint: fingerprint(ledger),
    sourceContentStored: ledger.sourceContentStored,
    selectionPerformed: ledger.selectionPerformed,
  };
}

function assertCompleteCoverage(ledger: PreallocationCapacityLedger) {
  const coverage = new Uint8Array(ledger.sourceBoundaryUnitCount);
  for (const unit of ledger.eligibleUnits) mark(coverage, unit.sourceUnitOrdinal, unit.sourceUnitOrdinal);
  for (const range of ledger.excludedRanges) {
    mark(coverage, range.sourceUnitStart, range.sourceUnitEnd);
  }
  if (coverage.some((count) => count !== 1)) {
    throw new Error(`${ledger.sourceRegisterId} capacity boundary coverage is missing or overlapping`);
  }
}

function mark(coverage: Uint8Array, start: number, end: number) {
  if (start < 0 || end >= coverage.length) throw new Error("Capacity unit is outside boundary");
  for (let ordinal = start; ordinal <= end; ordinal += 1) {
    coverage[ordinal] = (coverage[ordinal] ?? 0) + 1;
  }
}

function assertUnique(values: readonly string[], label: string) {
  if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label}`);
}

function fingerprint(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}
