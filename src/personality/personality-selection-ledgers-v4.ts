import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { parse } from "yaml";
import { z } from "zod";

import { loadPersonalityPreallocationCapacityManifestV1 } from
  "./personality-preallocation-capacity-manifest.js";
import { preallocationCapacityLedgerSchema } from
  "./personality-preallocation-capacity-ledger.js";
import type { PreallocationCapacityLedger } from
  "./personality-preallocation-capacity-ledger.js";
import { loadPersonalitySamplingPlanV4 } from "./personality-sampling-plan-v4.js";
import { systematicMidpointOrdinals } from "./personality-sampling-selection.js";
import { loadPersonalitySourceRegisterV3 } from "./personality-source-register-v3.js";

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
  label: z.string(),
}).strict();
const selectedUnitSchema = z.object({
  selectionId: z.string().regex(/^SEL-S\d{2}-\d{4}$/u),
  capacityUnitId: z.string().regex(/^C-S\d{2}-\d{4}$/u),
  sourceUnitOrdinal: z.number().int().nonnegative(),
  locator: locatorSchema,
  segmentFingerprint: sha256Schema,
  selectionRuleId: z.enum(["SAM-001", "SAM-002"]),
  primaryHighRiskStratum: highRiskSchema.nullable(),
  agreedHighRiskStrata: z.array(highRiskSchema),
}).strict();
const nonSelectedUnitSchema = z.object({
  capacityUnitId: z.string().regex(/^C-S\d{2}-\d{4}$/u),
  sourceUnitOrdinal: z.number().int().nonnegative(),
  locator: locatorSchema,
  segmentFingerprint: sha256Schema,
  reason: z.literal("not-selected-by-precommitted-v4-allocation"),
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

export const selectionLedgerV4Schema = z.object({
  schemaVersion: z.literal("jolene.personality-selection-ledger.v4"),
  status: z.literal("selected-from-precommitted-reviewed-capacity"),
  frozenAt: z.string().datetime(),
  sourceRegisterFingerprint: sha256Schema,
  capacityManifestFingerprint: sha256Schema,
  samplingPlanFingerprint: sha256Schema,
  sourceRegisterId: sourceIdSchema,
  sourceEventId: z.string().regex(/^E\d{3}$/u),
  capacityLedgerArtifactFingerprint: sha256Schema,
  capacityLedgerFingerprint: sha256Schema,
  sourceBoundaryUnitCount: z.number().int().positive(),
  eligibleCapacity: z.number().int().positive(),
  allocation: z.object({
    targetTurns: z.number().int().positive(),
    systematicTurns: z.number().int().nonnegative(),
    purposiveHighRiskTurns: z.number().int().nonnegative(),
  }).strict(),
  selectedUnits: z.array(selectedUnitSchema),
  nonSelectedEligibleUnits: z.array(nonSelectedUnitSchema),
  excludedRanges: z.array(excludedRangeSchema),
  sourceContentStored: z.literal(false),
  selectionPerformed: z.literal(true),
  outcomeBasedReplacementPerformed: z.literal(false),
  observationCodingPerformed: z.literal(false),
  traitAdmission: z.literal("prohibited"),
  runtimeActivation: z.literal("prohibited"),
}).strict().superRefine((ledger, context) => {
  const selectedIds = ledger.selectedUnits.map((unit) => unit.capacityUnitId);
  const nonSelectedIds = ledger.nonSelectedEligibleUnits.map((unit) => unit.capacityUnitId);
  if (new Set(selectedIds).size !== selectedIds.length ||
      new Set(nonSelectedIds).size !== nonSelectedIds.length ||
      selectedIds.some((id) => nonSelectedIds.includes(id))) {
    context.addIssue({ code: "custom", message: "Selection ledger eligible IDs overlap" });
  }
  const systematic = ledger.selectedUnits.filter(
    (unit) => unit.selectionRuleId === "SAM-001",
  );
  const purposive = ledger.selectedUnits.filter(
    (unit) => unit.selectionRuleId === "SAM-002",
  );
  if (ledger.selectedUnits.length !== ledger.allocation.targetTurns ||
      systematic.length !== ledger.allocation.systematicTurns ||
      purposive.length !== ledger.allocation.purposiveHighRiskTurns ||
      ledger.selectedUnits.length + ledger.nonSelectedEligibleUnits.length !==
        ledger.eligibleCapacity ||
      systematic.some((unit) => unit.primaryHighRiskStratum !== null) ||
      purposive.some((unit) => unit.primaryHighRiskStratum === null ||
        !unit.agreedHighRiskStrata.includes(unit.primaryHighRiskStratum))) {
    context.addIssue({ code: "custom", message: "Selection ledger allocation is inconsistent" });
  }
});

export type SelectionLedgerV4 = z.infer<typeof selectionLedgerV4Schema>;

const manifestEntrySchema = z.object({
  sourceRegisterId: sourceIdSchema,
  sourceEventId: z.string().regex(/^E\d{3}$/u),
  selectionLedgerArtifact: z.string().regex(
    /^research\/selection-ledgers-v4\/source-S\d{2}\.json$/u,
  ),
  selectionLedgerArtifactFingerprint: sha256Schema,
  selectedTurns: z.number().int().positive(),
  systematicTurns: z.number().int().nonnegative(),
  purposiveHighRiskTurns: z.number().int().nonnegative(),
  nonSelectedEligibleUnits: z.number().int().nonnegative(),
  excludedUnits: z.number().int().nonnegative(),
  excludedRanges: z.number().int().nonnegative(),
}).strict();

export const selectionManifestV4Schema = z.object({
  schemaVersion: z.literal("jolene.personality-selection-manifest.v4"),
  status: z.literal("immutable-selection-frozen-before-observation-coding"),
  frozenAt: z.string().datetime(),
  sourceRegisterFingerprint: sha256Schema,
  capacityManifestFingerprint: sha256Schema,
  samplingPlanFingerprint: sha256Schema,
  ledgers: z.array(manifestEntrySchema).length(10),
  totals: z.object({
    sources: z.literal(10),
    boundaryUnits: z.literal(1406),
    eligibleUnits: z.literal(588),
    selectedTurns: z.literal(120),
    systematicTurns: z.literal(96),
    purposiveHighRiskTurns: z.literal(24),
    nonSelectedEligibleUnits: z.literal(468),
    excludedUnits: z.literal(818),
    excludedRanges: z.literal(695),
  }).strict(),
  sourceContentStored: z.literal(false),
  selectionPerformed: z.literal(true),
  outcomeBasedReplacementPerformed: z.literal(false),
  observationCodingPerformed: z.literal(false),
  traitAdmission: z.literal("prohibited"),
  runtimeActivation: z.literal("prohibited"),
}).strict().superRefine((manifest, context) => {
  if (new Set(manifest.ledgers.map((entry) => entry.sourceRegisterId)).size !== 10) {
    context.addIssue({ code: "custom", message: "Selection manifest source IDs are duplicated" });
  }
});

export interface BuiltSelectionArtifactsV4 {
  readonly ledgers: readonly SelectionLedgerV4[];
  readonly ledgerTexts: readonly { readonly sourceId: string; readonly text: string }[];
  readonly manifest: z.infer<typeof selectionManifestV4Schema>;
}

export async function buildPersonalitySelectionArtifactsV4(
  frozenAt: string,
  projectRoot = process.cwd(),
): Promise<BuiltSelectionArtifactsV4> {
  const artifacts = await buildSelectionCandidateArtifactsV4(frozenAt, projectRoot);
  const duplicates = duplicateSelectedFingerprintGroups(artifacts.ledgers);
  if (duplicates.length > 0) {
    throw new Error(
      `Sampling plan v4 selects duplicate segment fingerprints (${duplicates.length} groups)`,
    );
  }
  return artifacts;
}

export async function auditPersonalitySelectionPlanV4(
  frozenAt: string,
  projectRoot = process.cwd(),
) {
  const artifacts = await buildSelectionCandidateArtifactsV4(frozenAt, projectRoot);
  const duplicateGroups = duplicateSelectedFingerprintGroups(artifacts.ledgers);
  return {
    schemaVersion: "jolene.personality-selection-plan-v4-audit.v1" as const,
    frozenAt,
    samplingPlanFingerprint: artifacts.manifest.samplingPlanFingerprint,
    candidateSelectedTurns: artifacts.manifest.totals.selectedTurns,
    duplicateGroups,
    duplicateSelectedTurns: duplicateGroups.reduce((sum, group) => sum + group.units.length, 0),
    selectionAccepted: duplicateGroups.length === 0,
    sourceContentStored: false,
    observationCodingPerformed: false,
    runtimeActivation: "prohibited" as const,
  };
}

async function buildSelectionCandidateArtifactsV4(
  frozenAt: string,
  projectRoot = process.cwd(),
): Promise<BuiltSelectionArtifactsV4> {
  const [register, capacity, planSnapshot] = await Promise.all([
    loadPersonalitySourceRegisterV3(projectRoot),
    loadPersonalityPreallocationCapacityManifestV1(projectRoot),
    loadPersonalitySamplingPlanV4(projectRoot),
  ]);
  if (Date.parse(frozenAt) < Date.parse(planSnapshot.createdAt)) {
    throw new Error("Selection freeze predates sampling plan v4");
  }
  const ledgers: SelectionLedgerV4[] = [];
  const ledgerTexts: Array<{ sourceId: string; text: string }> = [];
  for (const allocation of planSnapshot.plan.source_allocations) {
    const capacityEntry = capacity.ledgers.find(
      (entry) => entry.sourceRegisterId === allocation.source_register_id,
    );
    if (!capacityEntry) throw new Error(`${allocation.source_register_id} capacity is missing`);
    const capacityText = await readFile(path.resolve(projectRoot, capacityEntry.ledgerArtifact), "utf8");
    const capacityLedger = preallocationCapacityLedgerSchema.parse(JSON.parse(capacityText));
    const ledger = selectSource(
      frozenAt, register.registerFingerprint, capacity.manifestFingerprint,
      planSnapshot.planFingerprint, capacityEntry.ledgerArtifactFingerprint,
      capacityEntry.ledgerFingerprint, capacityLedger, allocation,
      planSnapshot.plan.selection_rules.purposive_high_risk.strata_priority,
    );
    const text = `${JSON.stringify(ledger, null, 2)}\n`;
    ledgers.push(ledger);
    ledgerTexts.push({ sourceId: allocation.source_register_id, text });
  }
  const manifestEntries = ledgers.map((ledger, index) => {
    const text = ledgerTexts[index]!.text;
    return {
      sourceRegisterId: ledger.sourceRegisterId,
      sourceEventId: ledger.sourceEventId,
      selectionLedgerArtifact: `research/selection-ledgers-v4/source-${ledger.sourceRegisterId}.json`,
      selectionLedgerArtifactFingerprint: digest(text),
      selectedTurns: ledger.selectedUnits.length,
      systematicTurns: ledger.selectedUnits.filter(
        (unit) => unit.selectionRuleId === "SAM-001",
      ).length,
      purposiveHighRiskTurns: ledger.selectedUnits.filter(
        (unit) => unit.selectionRuleId === "SAM-002",
      ).length,
      nonSelectedEligibleUnits: ledger.nonSelectedEligibleUnits.length,
      excludedUnits: ledger.sourceBoundaryUnitCount - ledger.eligibleCapacity,
      excludedRanges: ledger.excludedRanges.length,
    };
  });
  const manifest = selectionManifestV4Schema.parse({
    schemaVersion: "jolene.personality-selection-manifest.v4",
    status: "immutable-selection-frozen-before-observation-coding",
    frozenAt,
    sourceRegisterFingerprint: register.registerFingerprint,
    capacityManifestFingerprint: capacity.manifestFingerprint,
    samplingPlanFingerprint: planSnapshot.planFingerprint,
    ledgers: manifestEntries,
    totals: {
      sources: 10, boundaryUnits: 1406, eligibleUnits: 588, selectedTurns: 120,
      systematicTurns: 96, purposiveHighRiskTurns: 24,
      nonSelectedEligibleUnits: 468, excludedUnits: 818, excludedRanges: 695,
    },
    sourceContentStored: false, selectionPerformed: true,
    outcomeBasedReplacementPerformed: false, observationCodingPerformed: false,
    traitAdmission: "prohibited", runtimeActivation: "prohibited",
  });
  assertManifestTotals(manifest);
  return { ledgers, ledgerTexts, manifest };
}

export async function loadPersonalitySelectionArtifactsV4(projectRoot = process.cwd()) {
  const manifestText = await readFile(path.resolve(
    projectRoot, "research/selection-manifest-v4.yaml",
  ), "utf8");
  const manifest = selectionManifestV4Schema.parse(parse(manifestText));
  const expected = await buildPersonalitySelectionArtifactsV4(manifest.frozenAt, projectRoot);
  if (JSON.stringify(manifest) !== JSON.stringify(expected.manifest)) {
    throw new Error("Selection manifest v4 is stale");
  }
  for (const expectedLedger of expected.ledgerTexts) {
    const committed = await readFile(path.resolve(
      projectRoot, "research/selection-ledgers-v4", `source-${expectedLedger.sourceId}.json`,
    ), "utf8");
    if (committed !== expectedLedger.text) {
      throw new Error(`${expectedLedger.sourceId} selection ledger v4 is stale`);
    }
  }
  return {
    schemaVersion: manifest.schemaVersion,
    manifestFingerprint: digest(manifestText),
    totals: manifest.totals,
    ledgers: expected.ledgers.map((ledger) => ({
      sourceRegisterId: ledger.sourceRegisterId,
      selectedTurns: ledger.selectedUnits.length,
      systematicTurns: ledger.selectedUnits.filter(
        (unit) => unit.selectionRuleId === "SAM-001",
      ).length,
      purposiveHighRiskTurns: ledger.selectedUnits.filter(
        (unit) => unit.selectionRuleId === "SAM-002",
      ).length,
    })),
    sourceContentStored: false,
    selectionPerformed: true,
    outcomeBasedReplacementPerformed: false,
    observationCodingPerformed: false,
    runtimeActivation: "prohibited" as const,
  };
}

function selectSource(
  frozenAt: string,
  sourceRegisterFingerprint: string,
  capacityManifestFingerprint: string,
  samplingPlanFingerprint: string,
  capacityLedgerArtifactFingerprint: string,
  capacityLedgerFingerprint: string,
  capacity: PreallocationCapacityLedger,
  allocation: Awaited<ReturnType<typeof loadPersonalitySamplingPlanV4>>["plan"]["source_allocations"][number],
  priority: readonly z.infer<typeof highRiskSchema>[],
): SelectionLedgerV4 {
  const eligible = [...capacity.eligibleUnits].sort(
    (left, right) => left.sourceUnitOrdinal - right.sourceUnitOrdinal,
  );
  const systematicIndexes = systematicMidpointOrdinals(
    eligible.length, allocation.systematic_turns,
  );
  const systematicIds = new Set(systematicIndexes.map((index) => eligible[index]!.unitId));
  const purposive = selectPurposive(
    eligible, systematicIds, allocation.purposive_high_risk_turns, priority,
  );
  const purposiveById = new Map(purposive.map((item) => [item.unit.unitId, item.stratum]));
  const selectedCapacityUnits = eligible.filter(
    (unit) => systematicIds.has(unit.unitId) || purposiveById.has(unit.unitId),
  );
  const selectedUnits = selectedCapacityUnits.map((unit, index) => ({
    selectionId: `SEL-${capacity.sourceRegisterId}-${String(index + 1).padStart(4, "0")}`,
    capacityUnitId: unit.unitId,
    sourceUnitOrdinal: unit.sourceUnitOrdinal,
    locator: unit.locator,
    segmentFingerprint: unit.segmentFingerprint,
    selectionRuleId: systematicIds.has(unit.unitId) ? "SAM-001" as const : "SAM-002" as const,
    primaryHighRiskStratum: purposiveById.get(unit.unitId) ?? null,
    agreedHighRiskStrata: unit.agreedHighRiskStrata,
  }));
  const selectedIds = new Set(selectedCapacityUnits.map((unit) => unit.unitId));
  const nonSelectedEligibleUnits = eligible.filter((unit) => !selectedIds.has(unit.unitId))
    .map((unit) => ({
      capacityUnitId: unit.unitId,
      sourceUnitOrdinal: unit.sourceUnitOrdinal,
      locator: unit.locator,
      segmentFingerprint: unit.segmentFingerprint,
      reason: "not-selected-by-precommitted-v4-allocation" as const,
    }));
  const excludedRanges = capacity.excludedRanges.map((range) => ({
    exclusionId: range.exclusionId,
    sourceUnitStart: range.sourceUnitStart,
    sourceUnitEnd: range.sourceUnitEnd,
    locator: range.locator,
    segmentFingerprint: range.segmentFingerprint,
    reason: range.agreedReason,
  }));
  const ledger = selectionLedgerV4Schema.parse({
    schemaVersion: "jolene.personality-selection-ledger.v4",
    status: "selected-from-precommitted-reviewed-capacity",
    frozenAt,
    sourceRegisterFingerprint,
    capacityManifestFingerprint,
    samplingPlanFingerprint,
    sourceRegisterId: capacity.sourceRegisterId,
    sourceEventId: capacity.sourceEventId,
    capacityLedgerArtifactFingerprint,
    capacityLedgerFingerprint,
    sourceBoundaryUnitCount: capacity.sourceBoundaryUnitCount,
    eligibleCapacity: eligible.length,
    allocation: {
      targetTurns: allocation.target_turns,
      systematicTurns: allocation.systematic_turns,
      purposiveHighRiskTurns: allocation.purposive_high_risk_turns,
    },
    selectedUnits,
    nonSelectedEligibleUnits,
    excludedRanges,
    sourceContentStored: false,
    selectionPerformed: true,
    outcomeBasedReplacementPerformed: false,
    observationCodingPerformed: false,
    traitAdmission: "prohibited",
    runtimeActivation: "prohibited",
  });
  assertCompleteBoundaryCoverage(ledger);
  return ledger;
}

function selectPurposive(
  eligible: readonly PreallocationCapacityLedger["eligibleUnits"][number][],
  systematicIds: ReadonlySet<string>,
  target: number,
  priority: readonly z.infer<typeof highRiskSchema>[],
) {
  const selected = new Set<string>();
  const results: Array<{
    unit: PreallocationCapacityLedger["eligibleUnits"][number];
    stratum: z.infer<typeof highRiskSchema>;
  }> = [];
  while (results.length < target) {
    let progress = false;
    for (const stratum of priority) {
      const unit = eligible.find((candidate) =>
        candidate.highRiskReviewState === "consensus" &&
        !systematicIds.has(candidate.unitId) && !selected.has(candidate.unitId) &&
        candidate.agreedHighRiskStrata.includes(stratum)
      );
      if (!unit) continue;
      selected.add(unit.unitId);
      results.push({ unit, stratum });
      progress = true;
      if (results.length === target) break;
    }
    if (!progress) throw new Error("Insufficient consensus high-risk capacity after systematic selection");
  }
  return results;
}

function assertCompleteBoundaryCoverage(ledger: SelectionLedgerV4) {
  const coverage = new Uint8Array(ledger.sourceBoundaryUnitCount);
  for (const unit of [...ledger.selectedUnits, ...ledger.nonSelectedEligibleUnits]) {
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

function assertManifestTotals(manifest: z.infer<typeof selectionManifestV4Schema>) {
  const totals = manifest.ledgers.reduce((sum, ledger) => ({
    selectedTurns: sum.selectedTurns + ledger.selectedTurns,
    systematicTurns: sum.systematicTurns + ledger.systematicTurns,
    purposiveHighRiskTurns: sum.purposiveHighRiskTurns + ledger.purposiveHighRiskTurns,
    nonSelectedEligibleUnits: sum.nonSelectedEligibleUnits + ledger.nonSelectedEligibleUnits,
    excludedUnits: sum.excludedUnits + ledger.excludedUnits,
    excludedRanges: sum.excludedRanges + ledger.excludedRanges,
  }), {
    selectedTurns: 0, systematicTurns: 0, purposiveHighRiskTurns: 0,
    nonSelectedEligibleUnits: 0, excludedUnits: 0, excludedRanges: 0,
  });
  for (const [key, value] of Object.entries(totals)) {
    if (manifest.totals[key as keyof typeof totals] !== value) {
      throw new Error(`Selection manifest ${key} total is inconsistent`);
    }
  }
}

function duplicateSelectedFingerprintGroups(ledgers: readonly SelectionLedgerV4[]) {
  const groups = new Map<string, Array<{
    sourceRegisterId: z.infer<typeof sourceIdSchema>;
    capacityUnitId: string;
    locator: string;
    selectionRuleId: "SAM-001" | "SAM-002";
  }>>();
  for (const ledger of ledgers) {
    for (const unit of ledger.selectedUnits) {
      const group = groups.get(unit.segmentFingerprint) ?? [];
      group.push({
        sourceRegisterId: ledger.sourceRegisterId,
        capacityUnitId: unit.capacityUnitId,
        locator: unit.locator.label,
        selectionRuleId: unit.selectionRuleId,
      });
      groups.set(unit.segmentFingerprint, group);
    }
  }
  return [...groups.entries()].filter(([, units]) => units.length > 1)
    .map(([segmentFingerprint, units]) => ({ segmentFingerprint, units }))
    .sort((left, right) => left.segmentFingerprint.localeCompare(right.segmentFingerprint));
}

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
