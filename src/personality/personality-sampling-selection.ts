import { createHash } from "node:crypto";

import { z } from "zod";

import type { PersonalitySamplingPlanSnapshot } from "./personality-sampling-plan.js";

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const reviewerIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{2,63}$/);

export const samplingSegmentationRuleSchema = z.enum([
  "cnn-speaker-label-blocks-v1", "indexed-caption-speaker-blocks-v1",
  "paragraph-speaker-blocks-v1", "pdf-speaker-label-blocks-v1",
  "pdf-attributed-statement-blocks-v1", "vtt-speaker-cue-blocks-v1",
]);
export const samplingHighRiskStratumSchema = z.enum([
  "belief", "biography", "boundary", "contradiction", "grief-or-hurt", "humor",
  "identity-trait", "politics", "voice-adjacent", "workplace-sexual-boundary",
]);
export const samplingExclusionReasonSchema = z.enum([
  "advertisement-or-promotion", "duplicate-or-overlap", "interviewer-or-other-speaker",
  "lyric-or-performance", "non-verbal", "not-atomic", "speaker-attribution-unclear",
  "too-fragmentary", "unreviewable-boundary",
]);

const locatorSchema = z.object({
  kind: z.enum(["caption-index", "paragraph-index", "section-index", "timestamp"]),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  label: z.string().min(1),
}).strict().refine((locator) => locator.end >= locator.start,
  "Sampling locator end precedes start");

const reviewerSchema = z.object({
  reviewerId: reviewerIdSchema,
  reviewerType: z.enum(["ai", "human"]),
  tool: z.string().min(1),
  modelVersion: z.string().min(1).nullable(),
  classifiedAt: z.string().datetime(),
}).strict();

export const eligibleSamplingUnitSchema = z.object({
  universeEntryId: z.string().regex(/^U-S\d{2}-\d{4}$/),
  sourceRegisterId: z.string().regex(/^S\d{2}$/),
  sourceEventId: z.string().regex(/^E\d{3}$/),
  sourceUnitOrdinal: z.number().int().nonnegative(),
  eligibleOrdinal: z.number().int().nonnegative(),
  segmentationRule: samplingSegmentationRuleSchema,
  locator: locatorSchema,
  segmentFingerprint: sha256Schema,
  highRiskStrata: z.array(samplingHighRiskStratumSchema),
  reviewer: reviewerSchema,
}).strict();

export const excludedSamplingUnitSchema = z.object({
  exclusionId: z.string().regex(/^X-S\d{2}-\d{4}$/),
  sourceRegisterId: z.string().regex(/^S\d{2}$/),
  sourceEventId: z.string().regex(/^E\d{3}$/),
  sourceUnitStart: z.number().int().nonnegative(),
  sourceUnitEnd: z.number().int().nonnegative(),
  segmentationRule: samplingSegmentationRuleSchema,
  locator: locatorSchema,
  segmentFingerprint: sha256Schema,
  reason: samplingExclusionReasonSchema,
  reviewer: reviewerSchema,
}).strict().refine((unit) => unit.sourceUnitEnd >= unit.sourceUnitStart,
  "Excluded source-unit range is reversed");

export const sourceSelectionLedgerSchema = z.object({
  schemaVersion: z.literal("jolene.personality-source-selection-ledger.v2"),
  samplingPlanFingerprint: sha256Schema,
  sourceRegisterFingerprint: sha256Schema,
  sourceRegisterId: z.string().regex(/^S\d{2}$/),
  sourceEventId: z.string().regex(/^E\d{3}$/),
  sourceBoundaryUnitCount: z.number().int().positive(),
  segmentationRule: samplingSegmentationRuleSchema,
  eligibleUnits: z.array(eligibleSamplingUnitSchema).min(1),
  excludedUnits: z.array(excludedSamplingUnitSchema),
  sourceContentStored: z.literal(false),
  frozenBeforeSelectionAndCoding: z.literal(true),
}).strict();

export type EligibleSamplingUnit = z.infer<typeof eligibleSamplingUnitSchema>;
export type ExcludedSamplingUnit = z.infer<typeof excludedSamplingUnitSchema>;
export type SourceSelectionLedger = z.infer<typeof sourceSelectionLedgerSchema>;

export interface SelectedSamplingUnit {
  readonly universeEntryId: string;
  readonly sourceRegisterId: string;
  readonly sourceEventId: string;
  readonly sourceUnitOrdinal: number;
  readonly eligibleOrdinal: number;
  readonly sampleRuleId: "SAM-001" | "SAM-002";
  readonly primaryHighRiskStratum: z.infer<typeof samplingHighRiskStratumSchema> | null;
}

export interface SourceSelectionResult {
  readonly sourceRegisterId: string;
  readonly sourceEventId: string;
  readonly eligibleUnits: number;
  readonly excludedRanges: number;
  readonly systematicTurns: number;
  readonly purposiveHighRiskTurns: number;
  readonly selectedUnits: readonly SelectedSamplingUnit[];
  readonly ledgerFingerprint: string;
}

export function fingerprintSamplingUnitSegments(segments: readonly string[]): string {
  if (segments.length === 0) throw new Error("Sampling unit fingerprint requires source segments");
  const hash = createHash("sha256");
  for (const segment of segments) {
    const normalized = segment.normalize("NFC").replace(/\s+/g, " ").trim();
    if (!normalized) throw new Error("Sampling unit fingerprint contains an empty segment");
    const bytes = Buffer.from(normalized, "utf8");
    const length = Buffer.alloc(8);
    length.writeBigUInt64BE(BigInt(bytes.length));
    hash.update(length);
    hash.update(bytes);
  }
  return `sha256:${hash.digest("hex")}`;
}

export function validateAndSelectPersonalityLedgerSource(
  snapshot: PersonalitySamplingPlanSnapshot,
  ledgerInput: SourceSelectionLedger,
): SourceSelectionResult {
  if (snapshot.sourceRegisterState !== "current") {
    throw new Error("Superseded sampling plan cannot drive selection");
  }
  const plan = snapshot.plan;
  const ledger = sourceSelectionLedgerSchema.parse(ledgerInput);
  const allocation = plan.source_allocations.find(
    (candidate) => candidate.source_register_id === ledger.sourceRegisterId,
  );
  if (!allocation || allocation.source_event_id !== ledger.sourceEventId) {
    throw new Error(`Selection ledger is not allocated for ${ledger.sourceRegisterId}`);
  }
  if (ledger.samplingPlanFingerprint !== snapshot.planFingerprint ||
      ledger.sourceRegisterFingerprint !== plan.source_register.fingerprint) {
    throw new Error(`${ledger.sourceRegisterId} selection ledger snapshot is stale`);
  }
  if (ledger.segmentationRule !== allocation.segmentation_rule ||
      ledger.eligibleUnits.some((unit) => unit.segmentationRule !== allocation.segmentation_rule) ||
      ledger.excludedUnits.some((unit) => unit.segmentationRule !== allocation.segmentation_rule)) {
    throw new Error(`${ledger.sourceRegisterId} segmentation rule mismatch`);
  }
  if (ledger.eligibleUnits.some((unit) =>
        !unit.universeEntryId.startsWith(`U-${ledger.sourceRegisterId}-`)) ||
      ledger.excludedUnits.some((unit) =>
        !unit.exclusionId.startsWith(`X-${ledger.sourceRegisterId}-`))) {
    throw new Error(`${ledger.sourceRegisterId} ledger ID prefix mismatch`);
  }
  if (ledger.eligibleUnits.some((unit) => unit.locator.kind !== allocation.locator_unit) ||
      ledger.excludedUnits.some((unit) => unit.locator.kind !== allocation.locator_unit)) {
    throw new Error(`${ledger.sourceRegisterId} locator kind mismatch`);
  }
  assertUnitProvenance(ledger);
  assertUnique(ledger.eligibleUnits.map((unit) => unit.universeEntryId), "universe entry ID");
  assertUnique(ledger.excludedUnits.map((unit) => unit.exclusionId), "exclusion ID");
  assertUnique([
    ...ledger.eligibleUnits.map((unit) => unit.segmentFingerprint),
    ...ledger.excludedUnits.map((unit) => unit.segmentFingerprint),
  ], "selection-ledger segment fingerprint");
  for (const unit of ledger.eligibleUnits) {
    assertUnique(unit.highRiskStrata, `high-risk stratum on ${unit.universeEntryId}`);
  }
  const eligible = [...ledger.eligibleUnits].sort(
    (left, right) => left.eligibleOrdinal - right.eligibleOrdinal,
  );
  eligible.forEach((unit, index) => {
    if (unit.eligibleOrdinal !== index) {
      throw new Error(`${ledger.sourceRegisterId} eligible ordinals are not contiguous`);
    }
  });
  assertCompleteBoundaryCoverage(ledger);
  const systematicOrdinals = systematicMidpointOrdinals(
    eligible.length,
    allocation.systematic_turns,
  );
  const systematic = systematicOrdinals.map((ordinal) => selected(
    eligible[ordinal]!, "SAM-001", null,
  ));
  const systematicSet = new Set(systematicOrdinals);
  const highRisk = selectHighRiskUnits(
    eligible,
    systematicSet,
    allocation.purposive_high_risk_turns,
    plan.selection_rules.purposive_high_risk.strata_priority,
  );
  return {
    sourceRegisterId: ledger.sourceRegisterId,
    sourceEventId: ledger.sourceEventId,
    eligibleUnits: eligible.length,
    excludedRanges: ledger.excludedUnits.length,
    systematicTurns: systematic.length,
    purposiveHighRiskTurns: highRisk.length,
    selectedUnits: [...systematic, ...highRisk].sort(
      (left, right) => left.sourceUnitOrdinal - right.sourceUnitOrdinal,
    ),
    ledgerFingerprint: fingerprint(ledger),
  };
}

export function systematicMidpointOrdinals(
  eligibleCount: number,
  targetCount: number,
): readonly number[] {
  if (!Number.isInteger(eligibleCount) || !Number.isInteger(targetCount) ||
      targetCount < 0 || eligibleCount < targetCount) {
    throw new Error("Eligible universe is smaller than the systematic allocation");
  }
  const ordinals = Array.from({ length: targetCount }, (_, index) =>
    Math.floor((index + 0.5) * eligibleCount / targetCount));
  assertUnique(ordinals.map(String), "systematic midpoint ordinal");
  return ordinals;
}

function selectHighRiskUnits(
  eligible: readonly EligibleSamplingUnit[],
  systematicOrdinals: ReadonlySet<number>,
  targetCount: number,
  strataPriority: readonly z.infer<typeof samplingHighRiskStratumSchema>[],
): readonly SelectedSamplingUnit[] {
  const selectedOrdinals = new Set<number>();
  const results: SelectedSamplingUnit[] = [];
  while (results.length < targetCount) {
    let progress = false;
    for (const stratum of strataPriority) {
      const candidate = eligible.find((unit) =>
        !systematicOrdinals.has(unit.eligibleOrdinal) &&
        !selectedOrdinals.has(unit.eligibleOrdinal) &&
        unit.highRiskStrata.includes(stratum));
      if (!candidate) continue;
      selectedOrdinals.add(candidate.eligibleOrdinal);
      results.push(selected(candidate, "SAM-002", stratum));
      progress = true;
      if (results.length === targetCount) break;
    }
    if (!progress) throw new Error("High-risk universe cannot satisfy the purposive allocation");
  }
  return results;
}

function assertUnitProvenance(ledger: SourceSelectionLedger) {
  for (const unit of [...ledger.eligibleUnits, ...ledger.excludedUnits]) {
    if (unit.sourceRegisterId !== ledger.sourceRegisterId ||
        unit.sourceEventId !== ledger.sourceEventId) {
      throw new Error(`${ledger.sourceRegisterId} ledger unit provenance mismatch`);
    }
  }
}

function assertCompleteBoundaryCoverage(ledger: SourceSelectionLedger) {
  const coverage = new Array<number>(ledger.sourceBoundaryUnitCount).fill(0);
  for (const unit of ledger.eligibleUnits) {
    if (unit.sourceUnitOrdinal >= coverage.length) {
      throw new Error(`${ledger.sourceRegisterId} source-unit ordinal is out of range`);
    }
    const current = coverage[unit.sourceUnitOrdinal];
    if (current === undefined) throw new Error("Missing source-unit coverage slot");
    coverage[unit.sourceUnitOrdinal] = current + 1;
  }
  for (const exclusion of ledger.excludedUnits) {
    if (exclusion.sourceUnitEnd >= coverage.length) {
      throw new Error(`${ledger.sourceRegisterId} exclusion range is out of range`);
    }
    for (let ordinal = exclusion.sourceUnitStart; ordinal <= exclusion.sourceUnitEnd; ordinal += 1) {
      const current = coverage[ordinal];
      if (current === undefined) throw new Error("Missing exclusion coverage slot");
      coverage[ordinal] = current + 1;
    }
  }
  const invalid = coverage.findIndex((count) => count !== 1);
  if (invalid >= 0) {
    throw new Error(`${ledger.sourceRegisterId} boundary coverage is missing or overlapping at ${invalid}`);
  }
}

function selected(
  unit: EligibleSamplingUnit,
  sampleRuleId: "SAM-001" | "SAM-002",
  primaryHighRiskStratum: z.infer<typeof samplingHighRiskStratumSchema> | null,
): SelectedSamplingUnit {
  return {
    universeEntryId: unit.universeEntryId,
    sourceRegisterId: unit.sourceRegisterId,
    sourceEventId: unit.sourceEventId,
    sourceUnitOrdinal: unit.sourceUnitOrdinal,
    eligibleOrdinal: unit.eligibleOrdinal,
    sampleRuleId,
    primaryHighRiskStratum,
  };
}

function assertUnique(values: readonly string[], label: string) {
  if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label}`);
}

function fingerprint(value: unknown) {
  return `sha256:${createHash("sha256").update(stableStringify(value)).digest("hex")}`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
