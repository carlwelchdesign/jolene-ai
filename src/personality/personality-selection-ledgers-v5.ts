import { createHash } from "node:crypto";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { parse, stringify } from "yaml";
import { z } from "zod";

import { loadS03DuplicateOverlapAmendment } from
  "./personality-s03-duplicate-overlap-amendment.js";
import { loadS03DuplicateOverlapAudit } from
  "./personality-s03-duplicate-overlap-audit.js";
import { loadPersonalityPreallocationCapacityManifestV1 } from
  "./personality-preallocation-capacity-manifest.js";
import { preallocationCapacityLedgerSchema } from
  "./personality-preallocation-capacity-ledger.js";
import type { PreallocationCapacityLedger } from
  "./personality-preallocation-capacity-ledger.js";
import { loadPersonalitySamplingPlanV5 } from "./personality-sampling-plan-v5.js";
import { systematicMidpointOrdinals } from "./personality-sampling-selection.js";
import { loadPersonalitySourceRegisterV3 } from "./personality-source-register-v3.js";
import { loadS03UniqueCapacityView } from "./personality-s03-unique-capacity-view.js";

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const sourceIdSchema = z.enum([
  "S02", "S03", "S04", "S05", "S08", "S09", "S13", "S18", "S19", "S20",
]);
const highRiskSchema = z.enum([
  "belief", "biography", "boundary", "contradiction", "grief-or-hurt", "humor",
  "identity-trait", "politics", "voice-adjacent", "workplace-sexual-boundary",
]);
const locatorSchema = z.object({
  kind: z.enum(["paragraph-index", "section-index", "speaker-block-index", "pair-index"]),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  label: z.string().min(1),
}).strict();
const effectiveUnitIdSchema = z.string().regex(/^(?:C-S(?:0[2-5]|0[89]|13|18|19|20)-\d{4}|U-S03-\d{4})$/u);
const selectedUnitSchema = z.object({
  selectionId: z.string().regex(/^SEL-S\d{2}-\d{4}$/u),
  effectiveUnitId: effectiveUnitIdSchema,
  representativeCapacityUnitId: z.string().regex(/^C-S\d{2}-\d{4}$/u),
  sourceUnitOrdinal: z.number().int().nonnegative(),
  locator: locatorSchema,
  segmentFingerprint: sha256Schema,
  capacityBasis: z.enum(["reviewed-source-ledger", "reviewed-unique-capacity-view"]),
  selectionRuleId: z.enum(["SAM-001", "SAM-002"]),
  primaryHighRiskStratum: highRiskSchema.nullable(),
  agreedHighRiskStrata: z.array(highRiskSchema),
}).strict();
const nonSelectedUnitSchema = selectedUnitSchema.omit({
  selectionId: true,
  selectionRuleId: true,
  primaryHighRiskStratum: true,
}).extend({
  reason: z.literal("not-selected-by-precommitted-v5-allocation"),
}).strict();
const collapsedDuplicateSchema = z.object({
  capacityUnitId: z.string().regex(/^C-S03-\d{4}$/u),
  representativeEffectiveUnitId: z.string().regex(/^U-S03-\d{4}$/u),
  sourceUnitOrdinal: z.number().int().nonnegative(),
  locator: locatorSchema,
  segmentFingerprint: sha256Schema,
  reason: z.literal("exact-duplicate-collapsed-under-reviewed-amendment"),
}).strict();
const excludedRangeSchema = z.object({
  exclusionId: z.string().regex(/^CX-S\d{2}-\d{4}$/u),
  sourceUnitStart: z.number().int().nonnegative(),
  sourceUnitEnd: z.number().int().nonnegative(),
  locator: locatorSchema,
  segmentFingerprint: sha256Schema,
  reason: z.enum([
    "advertisement-or-promotion", "duplicate-or-overlap", "interviewer-or-other-speaker",
    "lyric-or-performance", "non-verbal", "not-atomic", "speaker-attribution-unclear",
    "too-fragmentary", "unreviewable-boundary",
  ]),
}).strict();

export const selectionLedgerV5Schema = z.object({
  schemaVersion: z.literal("jolene.personality-selection-ledger.v5"),
  status: z.literal("selected-from-precommitted-reviewed-unique-capacity"),
  frozenAt: z.string().datetime(),
  sourceRegisterFingerprint: sha256Schema,
  capacityManifestFingerprint: sha256Schema,
  samplingPlanFingerprint: sha256Schema,
  s03UniqueCapacityViewFingerprint: sha256Schema.nullable(),
  sourceRegisterId: sourceIdSchema,
  sourceEventId: z.string().regex(/^E\d{3}$/u),
  capacityLedgerArtifactFingerprint: sha256Schema,
  capacityLedgerFingerprint: sha256Schema,
  sourceBoundaryUnitCount: z.number().int().positive(),
  sourceEligibleOccurrences: z.number().int().positive(),
  effectiveEligibleCapacity: z.number().int().positive(),
  allocation: z.object({
    targetTurns: z.number().int().positive(),
    systematicTurns: z.number().int().nonnegative(),
    purposiveHighRiskTurns: z.number().int().nonnegative(),
  }).strict(),
  selectedUnits: z.array(selectedUnitSchema),
  nonSelectedEffectiveUnits: z.array(nonSelectedUnitSchema),
  collapsedDuplicateOccurrences: z.array(collapsedDuplicateSchema),
  excludedRanges: z.array(excludedRangeSchema),
  sourceContentStored: z.literal(false),
  selectionPerformed: z.literal(true),
  globalFingerprintUniquenessPreflight: z.literal("passed-before-artifact-write"),
  outcomeBasedReplacementPerformed: z.literal(false),
  observationCodingPerformed: z.literal(false),
  traitAdmission: z.literal("prohibited"),
  runtimeActivation: z.literal("prohibited"),
}).strict().superRefine((ledger, context) => {
  const selectedIds = ledger.selectedUnits.map((unit) => unit.effectiveUnitId);
  const nonSelectedIds = ledger.nonSelectedEffectiveUnits.map((unit) => unit.effectiveUnitId);
  const collapsedIds = ledger.collapsedDuplicateOccurrences.map((unit) => unit.capacityUnitId);
  const systematic = ledger.selectedUnits.filter((unit) => unit.selectionRuleId === "SAM-001");
  const purposive = ledger.selectedUnits.filter((unit) => unit.selectionRuleId === "SAM-002");
  const isS03 = ledger.sourceRegisterId === "S03";
  if (new Set(selectedIds).size !== selectedIds.length ||
      new Set(nonSelectedIds).size !== nonSelectedIds.length ||
      new Set(collapsedIds).size !== collapsedIds.length ||
      selectedIds.some((id) => nonSelectedIds.includes(id)) ||
      ledger.selectedUnits.length + ledger.nonSelectedEffectiveUnits.length !==
        ledger.effectiveEligibleCapacity ||
      ledger.effectiveEligibleCapacity + ledger.collapsedDuplicateOccurrences.length !==
        ledger.sourceEligibleOccurrences ||
      ledger.selectedUnits.length !== ledger.allocation.targetTurns ||
      systematic.length !== ledger.allocation.systematicTurns ||
      purposive.length !== ledger.allocation.purposiveHighRiskTurns ||
      systematic.some((unit) => unit.primaryHighRiskStratum !== null) ||
      purposive.some((unit) => unit.primaryHighRiskStratum === null ||
        !unit.agreedHighRiskStrata.includes(unit.primaryHighRiskStratum)) ||
      (isS03 !== (ledger.s03UniqueCapacityViewFingerprint !== null)) ||
      (isS03 !== (ledger.collapsedDuplicateOccurrences.length > 0)) ||
      [...ledger.selectedUnits, ...ledger.nonSelectedEffectiveUnits].some((unit) =>
        (isS03 !== (unit.capacityBasis === "reviewed-unique-capacity-view")) ||
        (isS03 !== unit.effectiveUnitId.startsWith("U-S03-")))) {
    context.addIssue({ code: "custom", message: "Selection ledger v5 is inconsistent" });
  }
});

export type SelectionLedgerV5 = z.infer<typeof selectionLedgerV5Schema>;

const manifestEntrySchema = z.object({
  sourceRegisterId: sourceIdSchema,
  sourceEventId: z.string().regex(/^E\d{3}$/u),
  selectionLedgerArtifact: z.string().regex(/^ledgers\/source-S\d{2}\.json$/u),
  selectionLedgerArtifactFingerprint: sha256Schema,
  sourceEligibleOccurrences: z.number().int().positive(),
  effectiveEligibleUnits: z.number().int().positive(),
  selectedTurns: z.number().int().positive(),
  systematicTurns: z.number().int().nonnegative(),
  purposiveHighRiskTurns: z.number().int().nonnegative(),
  nonSelectedEffectiveUnits: z.number().int().nonnegative(),
  collapsedDuplicateOccurrences: z.number().int().nonnegative(),
  excludedUnits: z.number().int().nonnegative(),
  excludedRanges: z.number().int().nonnegative(),
}).strict();

export const selectionManifestV5Schema = z.object({
  schemaVersion: z.literal("jolene.personality-selection-manifest.v5"),
  status: z.literal("immutable-selection-frozen-before-observation-coding"),
  frozenAt: z.string().datetime(),
  sourceRegisterFingerprint: sha256Schema,
  capacityManifestFingerprint: sha256Schema,
  samplingPlanFingerprint: sha256Schema,
  s03DuplicateOverlapAuditFingerprint: sha256Schema,
  s03DuplicateOverlapAmendmentFingerprint: sha256Schema,
  s03UniqueCapacityViewFingerprint: sha256Schema,
  ledgers: z.array(manifestEntrySchema).length(10),
  totals: z.object({
    sources: z.literal(10),
    boundaryUnits: z.literal(1406),
    sourceEligibleOccurrences: z.literal(588),
    effectiveEligibleUnits: z.literal(451),
    selectedTurns: z.literal(120),
    systematicTurns: z.literal(96),
    purposiveHighRiskTurns: z.literal(24),
    nonSelectedEffectiveUnits: z.literal(331),
    collapsedDuplicateOccurrences: z.literal(137),
    excludedUnits: z.literal(818),
    excludedRanges: z.literal(695),
    uniqueSelectedSegmentFingerprints: z.literal(120),
  }).strict(),
  sourceContentStored: z.literal(false),
  selectionPerformed: z.literal(true),
  globalFingerprintUniquenessPreflight: z.literal("passed-before-artifact-write"),
  artifactWrite: z.literal("atomic-directory-promotion-after-all-preflights"),
  outcomeBasedReplacementPerformed: z.literal(false),
  observationCodingPerformed: z.literal(false),
  traitAdmission: z.literal("prohibited"),
  runtimeActivation: z.literal("prohibited"),
}).strict().superRefine((manifest, context) => {
  if (new Set(manifest.ledgers.map((entry) => entry.sourceRegisterId)).size !== 10) {
    context.addIssue({ code: "custom", message: "Selection manifest v5 source IDs are duplicated" });
  }
});

export interface BuiltSelectionArtifactsV5 {
  readonly ledgers: readonly SelectionLedgerV5[];
  readonly ledgerTexts: readonly { readonly sourceId: string; readonly text: string }[];
  readonly manifest: z.infer<typeof selectionManifestV5Schema>;
  readonly manifestText: string;
}

interface EffectiveUnit {
  readonly effectiveUnitId: string;
  readonly representativeCapacityUnitId: string;
  readonly sourceUnitOrdinal: number;
  readonly locator: z.infer<typeof locatorSchema>;
  readonly segmentFingerprint: string;
  readonly capacityBasis: "reviewed-source-ledger" | "reviewed-unique-capacity-view";
  readonly highRiskReviewState: "consensus" | "uncertainty-withheld";
  readonly agreedHighRiskStrata: readonly z.infer<typeof highRiskSchema>[];
}

export async function buildPersonalitySelectionArtifactsV5(
  frozenAt: string,
  projectRoot = process.cwd(),
): Promise<BuiltSelectionArtifactsV5> {
  const [register, capacity, plan, unique, audit, amendment] = await Promise.all([
    loadPersonalitySourceRegisterV3(projectRoot),
    loadPersonalityPreallocationCapacityManifestV1(projectRoot),
    loadPersonalitySamplingPlanV5(projectRoot),
    loadS03UniqueCapacityView(projectRoot),
    loadS03DuplicateOverlapAudit(projectRoot),
    loadS03DuplicateOverlapAmendment(projectRoot),
  ]);
  if (Date.parse(frozenAt) < Date.parse(plan.createdAt)) {
    throw new Error("Selection freeze predates sampling plan v5");
  }
  const ledgers: SelectionLedgerV5[] = [];
  for (const allocation of plan.plan.source_allocations) {
    const capacityEntry = capacity.ledgers.find(
      (entry) => entry.sourceRegisterId === allocation.source_register_id,
    );
    if (!capacityEntry) throw new Error(`${allocation.source_register_id} capacity is missing`);
    const capacityText = await readFile(path.resolve(projectRoot, capacityEntry.ledgerArtifact), "utf8");
    const sourceLedger = preallocationCapacityLedgerSchema.parse(JSON.parse(capacityText));
    const sourceView = allocation.source_register_id === "S03"
      ? buildS03EffectiveView(sourceLedger, unique)
      : buildSourceLedgerView(sourceLedger);
    ledgers.push(selectSource(
      frozenAt,
      register.registerFingerprint,
      capacity.manifestFingerprint,
      plan.planFingerprint,
      capacityEntry.ledgerArtifactFingerprint,
      capacityEntry.ledgerFingerprint,
      allocation.source_register_id === "S03" ? unique.viewFingerprint : null,
      sourceLedger,
      sourceView.effectiveUnits,
      sourceView.collapsedDuplicates,
      allocation,
      plan.plan.selection_rules.purposive_high_risk.strata_priority,
    ));
  }
  assertGloballyUniqueSelectedFingerprints(ledgers);
  const ledgerTexts = ledgers.map((ledger) => ({
    sourceId: ledger.sourceRegisterId,
    text: `${JSON.stringify(ledger, null, 2)}\n`,
  }));
  const manifestEntries = ledgers.map((ledger, index) => ({
    sourceRegisterId: ledger.sourceRegisterId,
    sourceEventId: ledger.sourceEventId,
    selectionLedgerArtifact: `ledgers/source-${ledger.sourceRegisterId}.json`,
    selectionLedgerArtifactFingerprint: digest(ledgerTexts[index]!.text),
    sourceEligibleOccurrences: ledger.sourceEligibleOccurrences,
    effectiveEligibleUnits: ledger.effectiveEligibleCapacity,
    selectedTurns: ledger.selectedUnits.length,
    systematicTurns: ledger.selectedUnits.filter((unit) => unit.selectionRuleId === "SAM-001").length,
    purposiveHighRiskTurns: ledger.selectedUnits.filter((unit) => unit.selectionRuleId === "SAM-002").length,
    nonSelectedEffectiveUnits: ledger.nonSelectedEffectiveUnits.length,
    collapsedDuplicateOccurrences: ledger.collapsedDuplicateOccurrences.length,
    excludedUnits: ledger.sourceBoundaryUnitCount - ledger.sourceEligibleOccurrences,
    excludedRanges: ledger.excludedRanges.length,
  }));
  const manifest = selectionManifestV5Schema.parse({
    schemaVersion: "jolene.personality-selection-manifest.v5",
    status: "immutable-selection-frozen-before-observation-coding",
    frozenAt,
    sourceRegisterFingerprint: register.registerFingerprint,
    capacityManifestFingerprint: capacity.manifestFingerprint,
    samplingPlanFingerprint: plan.planFingerprint,
    s03DuplicateOverlapAuditFingerprint: audit.auditFingerprint,
    s03DuplicateOverlapAmendmentFingerprint: amendment.amendmentFingerprint,
    s03UniqueCapacityViewFingerprint: unique.viewFingerprint,
    ledgers: manifestEntries,
    totals: {
      sources: 10,
      boundaryUnits: 1406,
      sourceEligibleOccurrences: 588,
      effectiveEligibleUnits: 451,
      selectedTurns: 120,
      systematicTurns: 96,
      purposiveHighRiskTurns: 24,
      nonSelectedEffectiveUnits: 331,
      collapsedDuplicateOccurrences: 137,
      excludedUnits: 818,
      excludedRanges: 695,
      uniqueSelectedSegmentFingerprints: 120,
    },
    sourceContentStored: false,
    selectionPerformed: true,
    globalFingerprintUniquenessPreflight: "passed-before-artifact-write",
    artifactWrite: "atomic-directory-promotion-after-all-preflights",
    outcomeBasedReplacementPerformed: false,
    observationCodingPerformed: false,
    traitAdmission: "prohibited",
    runtimeActivation: "prohibited",
  });
  assertManifestTotals(manifest);
  return {
    ledgers,
    ledgerTexts,
    manifest,
    manifestText: stringify(manifest, { lineWidth: 120 }),
  };
}

export async function writePersonalitySelectionArtifactsV5(
  frozenAt: string,
  projectRoot = process.cwd(),
  outputRoot = path.resolve(projectRoot, "research/selection-v5"),
): Promise<BuiltSelectionArtifactsV5> {
  const artifacts = await buildPersonalitySelectionArtifactsV5(frozenAt, projectRoot);
  if (await exists(outputRoot)) {
    throw new Error("Immutable selection-v5 output already exists");
  }
  const stagingRoot = path.resolve(
    path.dirname(outputRoot), `.selection-v5-stage-${process.pid}-${Date.now()}`,
  );
  try {
    await mkdir(path.resolve(stagingRoot, "ledgers"), { recursive: true, mode: 0o700 });
    await Promise.all([
      writeFile(path.resolve(stagingRoot, "manifest.yaml"), artifacts.manifestText, {
        encoding: "utf8", mode: 0o600,
      }),
      ...artifacts.ledgerTexts.map((ledger) => writeFile(
        path.resolve(stagingRoot, "ledgers", `source-${ledger.sourceId}.json`),
        ledger.text,
        { encoding: "utf8", mode: 0o600 },
      )),
    ]);
    await rename(stagingRoot, outputRoot);
  } catch (error) {
    await rm(stagingRoot, { recursive: true, force: true });
    throw error;
  }
  return artifacts;
}

export async function loadPersonalitySelectionArtifactsV5(projectRoot = process.cwd()) {
  const selectionRoot = path.resolve(projectRoot, "research/selection-v5");
  const manifestText = await readFile(path.resolve(selectionRoot, "manifest.yaml"), "utf8");
  const manifest = selectionManifestV5Schema.parse(parse(manifestText));
  const expected = await buildPersonalitySelectionArtifactsV5(manifest.frozenAt, projectRoot);
  if (JSON.stringify(manifest) !== JSON.stringify(expected.manifest)) {
    throw new Error("Selection manifest v5 is stale");
  }
  for (const ledger of expected.ledgerTexts) {
    const committed = await readFile(path.resolve(
      selectionRoot, "ledgers", `source-${ledger.sourceId}.json`,
    ), "utf8");
    if (committed !== ledger.text) throw new Error(`${ledger.sourceId} selection ledger v5 is stale`);
  }
  return {
    schemaVersion: manifest.schemaVersion,
    manifestFingerprint: digest(manifestText),
    totals: manifest.totals,
    ledgers: expected.ledgers,
    sourceContentStored: false,
    selectionPerformed: true,
    observationCodingPerformed: false,
    runtimeActivation: "prohibited" as const,
  };
}

function buildSourceLedgerView(capacity: PreallocationCapacityLedger) {
  return {
    effectiveUnits: capacity.eligibleUnits.map((unit): EffectiveUnit => ({
      effectiveUnitId: unit.unitId,
      representativeCapacityUnitId: unit.unitId,
      sourceUnitOrdinal: unit.sourceUnitOrdinal,
      locator: unit.locator,
      segmentFingerprint: unit.segmentFingerprint,
      capacityBasis: "reviewed-source-ledger",
      highRiskReviewState: unit.highRiskReviewState,
      agreedHighRiskStrata: unit.agreedHighRiskStrata,
    })),
    collapsedDuplicates: [] as z.infer<typeof collapsedDuplicateSchema>[],
  };
}

function buildS03EffectiveView(
  capacity: PreallocationCapacityLedger,
  unique: Awaited<ReturnType<typeof loadS03UniqueCapacityView>>,
) {
  const capacityById = new Map(capacity.eligibleUnits.map((unit) => [unit.unitId, unit]));
  const effectiveUnits = unique.units.map((unit): EffectiveUnit => {
    const representative = capacityById.get(unit.representativeCapacityUnitId);
    if (!representative || representative.segmentFingerprint !== unit.segmentFingerprint ||
        representative.sourceUnitOrdinal !== unit.representativeSourceUnitOrdinal ||
        representative.locator.label !== unit.locator) {
      throw new Error(`${unit.uniqueUnitId} representative provenance is stale`);
    }
    return {
      effectiveUnitId: unit.uniqueUnitId,
      representativeCapacityUnitId: representative.unitId,
      sourceUnitOrdinal: representative.sourceUnitOrdinal,
      locator: representative.locator,
      segmentFingerprint: representative.segmentFingerprint,
      capacityBasis: "reviewed-unique-capacity-view",
      highRiskReviewState: unit.highRiskReviewState,
      agreedHighRiskStrata: unit.agreedHighRiskStrata,
    };
  });
  const collapsedDuplicates = unique.units.flatMap((unit) =>
    unit.duplicateCapacityUnitIds.map((capacityUnitId) => {
      const duplicate = capacityById.get(capacityUnitId);
      if (!duplicate || duplicate.segmentFingerprint !== unit.segmentFingerprint) {
        throw new Error(`${capacityUnitId} duplicate provenance is stale`);
      }
      return collapsedDuplicateSchema.parse({
        capacityUnitId,
        representativeEffectiveUnitId: unit.uniqueUnitId,
        sourceUnitOrdinal: duplicate.sourceUnitOrdinal,
        locator: duplicate.locator,
        segmentFingerprint: duplicate.segmentFingerprint,
        reason: "exact-duplicate-collapsed-under-reviewed-amendment",
      });
    })
  );
  return { effectiveUnits, collapsedDuplicates };
}

function selectSource(
  frozenAt: string,
  sourceRegisterFingerprint: string,
  capacityManifestFingerprint: string,
  samplingPlanFingerprint: string,
  capacityLedgerArtifactFingerprint: string,
  capacityLedgerFingerprint: string,
  uniqueViewFingerprint: string | null,
  capacity: PreallocationCapacityLedger,
  rawEffectiveUnits: readonly EffectiveUnit[],
  collapsedDuplicates: readonly z.infer<typeof collapsedDuplicateSchema>[],
  allocation: Awaited<ReturnType<typeof loadPersonalitySamplingPlanV5>>["plan"]["source_allocations"][number],
  priority: readonly z.infer<typeof highRiskSchema>[],
): SelectionLedgerV5 {
  const eligible = [...rawEffectiveUnits].sort(
    (left, right) => left.sourceUnitOrdinal - right.sourceUnitOrdinal ||
      left.effectiveUnitId.localeCompare(right.effectiveUnitId),
  );
  const systematicIndexes = systematicMidpointOrdinals(eligible.length, allocation.systematic_turns);
  const systematicIds = new Set(systematicIndexes.map((index) => eligible[index]!.effectiveUnitId));
  const purposive = selectPurposive(
    eligible, systematicIds, allocation.purposive_high_risk_turns, priority,
  );
  const purposiveById = new Map(
    purposive.map((item) => [item.unit.effectiveUnitId, item.stratum]),
  );
  const selectedCapacityUnits = eligible.filter(
    (unit) => systematicIds.has(unit.effectiveUnitId) || purposiveById.has(unit.effectiveUnitId),
  );
  const selectedUnits = selectedCapacityUnits.map((unit, index) => ({
    selectionId: `SEL-${capacity.sourceRegisterId}-${String(index + 1).padStart(4, "0")}`,
    effectiveUnitId: unit.effectiveUnitId,
    representativeCapacityUnitId: unit.representativeCapacityUnitId,
    sourceUnitOrdinal: unit.sourceUnitOrdinal,
    locator: unit.locator,
    segmentFingerprint: unit.segmentFingerprint,
    capacityBasis: unit.capacityBasis,
    selectionRuleId: systematicIds.has(unit.effectiveUnitId) ? "SAM-001" as const : "SAM-002" as const,
    primaryHighRiskStratum: purposiveById.get(unit.effectiveUnitId) ?? null,
    agreedHighRiskStrata: unit.agreedHighRiskStrata,
  }));
  const selectedIds = new Set(selectedCapacityUnits.map((unit) => unit.effectiveUnitId));
  const nonSelectedEffectiveUnits = eligible.filter((unit) => !selectedIds.has(unit.effectiveUnitId))
    .map((unit) => ({
      effectiveUnitId: unit.effectiveUnitId,
      representativeCapacityUnitId: unit.representativeCapacityUnitId,
      sourceUnitOrdinal: unit.sourceUnitOrdinal,
      locator: unit.locator,
      segmentFingerprint: unit.segmentFingerprint,
      capacityBasis: unit.capacityBasis,
      agreedHighRiskStrata: unit.agreedHighRiskStrata,
      reason: "not-selected-by-precommitted-v5-allocation" as const,
    }));
  const excludedRanges = capacity.excludedRanges.map((range) => ({
    exclusionId: range.exclusionId,
    sourceUnitStart: range.sourceUnitStart,
    sourceUnitEnd: range.sourceUnitEnd,
    locator: range.locator,
    segmentFingerprint: range.segmentFingerprint,
    reason: range.agreedReason,
  }));
  const ledger = selectionLedgerV5Schema.parse({
    schemaVersion: "jolene.personality-selection-ledger.v5",
    status: "selected-from-precommitted-reviewed-unique-capacity",
    frozenAt,
    sourceRegisterFingerprint,
    capacityManifestFingerprint,
    samplingPlanFingerprint,
    s03UniqueCapacityViewFingerprint: uniqueViewFingerprint,
    sourceRegisterId: capacity.sourceRegisterId,
    sourceEventId: capacity.sourceEventId,
    capacityLedgerArtifactFingerprint,
    capacityLedgerFingerprint,
    sourceBoundaryUnitCount: capacity.sourceBoundaryUnitCount,
    sourceEligibleOccurrences: capacity.eligibleUnits.length,
    effectiveEligibleCapacity: eligible.length,
    allocation: {
      targetTurns: allocation.target_turns,
      systematicTurns: allocation.systematic_turns,
      purposiveHighRiskTurns: allocation.purposive_high_risk_turns,
    },
    selectedUnits,
    nonSelectedEffectiveUnits,
    collapsedDuplicateOccurrences: collapsedDuplicates,
    excludedRanges,
    sourceContentStored: false,
    selectionPerformed: true,
    globalFingerprintUniquenessPreflight: "passed-before-artifact-write",
    outcomeBasedReplacementPerformed: false,
    observationCodingPerformed: false,
    traitAdmission: "prohibited",
    runtimeActivation: "prohibited",
  });
  assertCompleteBoundaryCoverage(ledger);
  return ledger;
}

function selectPurposive(
  eligible: readonly EffectiveUnit[],
  systematicIds: ReadonlySet<string>,
  target: number,
  priority: readonly z.infer<typeof highRiskSchema>[],
) {
  const selected = new Set<string>();
  const results: Array<{ unit: EffectiveUnit; stratum: z.infer<typeof highRiskSchema> }> = [];
  while (results.length < target) {
    let progress = false;
    for (const stratum of priority) {
      const unit = eligible.find((candidate) =>
        candidate.highRiskReviewState === "consensus" &&
        !systematicIds.has(candidate.effectiveUnitId) &&
        !selected.has(candidate.effectiveUnitId) &&
        candidate.agreedHighRiskStrata.includes(stratum)
      );
      if (!unit) continue;
      selected.add(unit.effectiveUnitId);
      results.push({ unit, stratum });
      progress = true;
      if (results.length === target) break;
    }
    if (!progress) throw new Error("Insufficient consensus high-risk capacity after systematic selection");
  }
  return results;
}

function assertCompleteBoundaryCoverage(ledger: SelectionLedgerV5): void {
  const coverage = new Uint8Array(ledger.sourceBoundaryUnitCount);
  for (const unit of [...ledger.selectedUnits, ...ledger.nonSelectedEffectiveUnits]) {
    coverage[unit.sourceUnitOrdinal] = (coverage[unit.sourceUnitOrdinal] ?? 0) + 1;
  }
  for (const unit of ledger.collapsedDuplicateOccurrences) {
    coverage[unit.sourceUnitOrdinal] = (coverage[unit.sourceUnitOrdinal] ?? 0) + 1;
  }
  for (const range of ledger.excludedRanges) {
    for (let ordinal = range.sourceUnitStart; ordinal <= range.sourceUnitEnd; ordinal += 1) {
      if (ordinal >= coverage.length) throw new Error("Selection exclusion exceeds source boundary");
      coverage[ordinal] = (coverage[ordinal] ?? 0) + 1;
    }
  }
  if (coverage.some((count) => count !== 1)) {
    throw new Error(`${ledger.sourceRegisterId} selection boundary coverage is incomplete`);
  }
}

export function assertGloballyUniqueSelectedFingerprints(
  ledgers: readonly Pick<SelectionLedgerV5, "sourceRegisterId" | "selectedUnits">[],
): void {
  const seen = new Map<string, string>();
  for (const ledger of ledgers) {
    for (const unit of ledger.selectedUnits) {
      const prior = seen.get(unit.segmentFingerprint);
      if (prior) {
        throw new Error(
          `Duplicate selected segment fingerprint ${unit.segmentFingerprint} (${prior}, ${ledger.sourceRegisterId}/${unit.effectiveUnitId})`,
        );
      }
      seen.set(unit.segmentFingerprint, `${ledger.sourceRegisterId}/${unit.effectiveUnitId}`);
    }
  }
  if (seen.size !== 120) throw new Error(`Expected 120 globally unique selections, received ${seen.size}`);
}

function assertManifestTotals(manifest: z.infer<typeof selectionManifestV5Schema>): void {
  const totals = manifest.ledgers.reduce((sum, ledger) => ({
    sourceEligibleOccurrences: sum.sourceEligibleOccurrences + ledger.sourceEligibleOccurrences,
    effectiveEligibleUnits: sum.effectiveEligibleUnits + ledger.effectiveEligibleUnits,
    selectedTurns: sum.selectedTurns + ledger.selectedTurns,
    systematicTurns: sum.systematicTurns + ledger.systematicTurns,
    purposiveHighRiskTurns: sum.purposiveHighRiskTurns + ledger.purposiveHighRiskTurns,
    nonSelectedEffectiveUnits: sum.nonSelectedEffectiveUnits + ledger.nonSelectedEffectiveUnits,
    collapsedDuplicateOccurrences:
      sum.collapsedDuplicateOccurrences + ledger.collapsedDuplicateOccurrences,
    excludedUnits: sum.excludedUnits + ledger.excludedUnits,
    excludedRanges: sum.excludedRanges + ledger.excludedRanges,
  }), {
    sourceEligibleOccurrences: 0,
    effectiveEligibleUnits: 0,
    selectedTurns: 0,
    systematicTurns: 0,
    purposiveHighRiskTurns: 0,
    nonSelectedEffectiveUnits: 0,
    collapsedDuplicateOccurrences: 0,
    excludedUnits: 0,
    excludedRanges: 0,
  });
  for (const [key, value] of Object.entries(totals)) {
    if (manifest.totals[key as keyof typeof totals] !== value) {
      throw new Error(`Selection manifest v5 ${key} total is inconsistent`);
    }
  }
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
