import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { loadS03DuplicateOverlapAmendment } from
  "./personality-s03-duplicate-overlap-amendment.js";
import { loadS03DuplicateOverlapAudit } from
  "./personality-s03-duplicate-overlap-audit.js";

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const highRiskSchema = z.enum([
  "belief", "biography", "boundary", "contradiction", "grief-or-hurt", "humor",
  "identity-trait", "politics", "voice-adjacent", "workplace-sexual-boundary",
]);
const unitSchema = z.object({
  uniqueUnitId: z.string().regex(/^U-S03-\d{4}$/u),
  duplicateGroupId: z.string().regex(/^DG-S03-\d{4}$/u),
  segmentFingerprint: sha256Schema,
  representativeCapacityUnitId: z.string().regex(/^C-S03-\d{4}$/u),
  representativeSourceUnitOrdinal: z.number().int().nonnegative(),
  locator: z.string().regex(/^speaker-block-\d+$/u),
  duplicateCapacityUnitIds: z.array(z.string().regex(/^C-S03-\d{4}$/u)).min(1),
  occurrenceCount: z.number().int().min(2),
  highRiskReviewState: z.enum(["consensus", "uncertainty-withheld"]),
  agreedHighRiskStrata: z.array(highRiskSchema),
  withheldCandidateStrata: z.array(highRiskSchema),
}).strict().superRefine((unit, context) => {
  if (unit.occurrenceCount !== unit.duplicateCapacityUnitIds.length + 1 ||
      unit.duplicateCapacityUnitIds.includes(unit.representativeCapacityUnitId) ||
      new Set(unit.duplicateCapacityUnitIds).size !== unit.duplicateCapacityUnitIds.length ||
      (unit.highRiskReviewState === "uncertainty-withheld" &&
        unit.agreedHighRiskStrata.length !== 0) ||
      (unit.highRiskReviewState === "consensus" &&
        unit.withheldCandidateStrata.length !== 0)) {
    context.addIssue({ code: "custom", message: `${unit.uniqueUnitId} is inconsistent` });
  }
});

export const s03UniqueCapacityViewSchema = z.object({
  schemaVersion: z.literal("jolene.personality-s03-unique-capacity-view.v1"),
  status: z.literal("frozen-before-new-sampling-plan"),
  frozenAt: z.string().datetime(),
  sourceRegisterId: z.literal("S03"),
  sourceEventId: z.literal("E003"),
  duplicateOverlapAuditFingerprint: sha256Schema,
  duplicateOverlapAmendmentFingerprint: sha256Schema,
  sourceRegisterFingerprint: sha256Schema,
  capacityManifestFingerprint: sha256Schema,
  sourceCapacityLedgerArtifactFingerprint: sha256Schema,
  sourceCapacityLedgerFingerprint: sha256Schema,
  samplingPlanV4OutcomeFingerprint: sha256Schema,
  policy: z.object({
    equivalence: z.literal("exact-canonical-segment-fingerprint"),
    representative: z.literal("lowest-source-unit-ordinal-then-capacity-unit-id"),
    conflictResult: z.literal("withhold-entire-group-never-union"),
  }).strict(),
  counts: z.object({
    sourceEligibleOccurrences: z.literal(270),
    uniqueCapacityUnits: z.literal(133),
    excludedDuplicateOccurrences: z.literal(137),
    consensusUnits: z.literal(70),
    uncertaintyWithheldUnits: z.literal(63),
    unitsWithAdmittedHighRiskStrata: z.literal(49),
  }).strict(),
  units: z.array(unitSchema).length(133),
  sourceContentStored: z.literal(false),
  selectionPerformed: z.literal(false),
  observationCodingPerformed: z.literal(false),
  traitAdmission: z.literal("prohibited"),
  runtimeActivation: z.literal("prohibited"),
  nextAction: z.literal("freeze-sampling-plan-v5-against-unique-capacity-view"),
}).strict().superRefine((view, context) => {
  const capacityIds = view.units.flatMap((unit) => [
    unit.representativeCapacityUnitId, ...unit.duplicateCapacityUnitIds,
  ]);
  const ordered = [...view.units].sort(
    (left, right) => left.segmentFingerprint.localeCompare(right.segmentFingerprint),
  );
  if (capacityIds.length !== 270 || new Set(capacityIds).size !== 270 ||
      new Set(view.units.map((unit) => unit.segmentFingerprint)).size !== 133 ||
      JSON.stringify(view.units) !== JSON.stringify(ordered)) {
    context.addIssue({ code: "custom", message: "Unique S03 view does not partition capacity" });
  }
});

export type S03UniqueCapacityView = z.infer<typeof s03UniqueCapacityViewSchema>;

export async function buildS03UniqueCapacityView(
  frozenAt: string,
  projectRoot = process.cwd(),
): Promise<S03UniqueCapacityView> {
  const [audit, amendment] = await Promise.all([
    loadS03DuplicateOverlapAudit(projectRoot),
    loadS03DuplicateOverlapAmendment(projectRoot),
  ]);
  if (Date.parse(frozenAt) < Date.parse(amendment.frozenAt)) {
    throw new Error("Unique S03 capacity view predates its amendment");
  }
  const units = audit.groups.map((group, index) => ({
    uniqueUnitId: `U-S03-${String(index + 1).padStart(4, "0")}`,
    duplicateGroupId: group.groupId,
    segmentFingerprint: group.segmentFingerprint,
    representativeCapacityUnitId: group.representativeCapacityUnitId,
    representativeSourceUnitOrdinal: group.representativeSourceUnitOrdinal,
    locator: group.members[0]!.locator,
    duplicateCapacityUnitIds: group.members.slice(1).map((member) => member.capacityUnitId),
    occurrenceCount: group.memberCount,
    highRiskReviewState: group.proposedHighRiskReviewState,
    agreedHighRiskStrata: group.proposedAgreedHighRiskStrata,
    withheldCandidateStrata: group.proposedWithheldCandidateStrata,
  }));
  return s03UniqueCapacityViewSchema.parse({
    schemaVersion: "jolene.personality-s03-unique-capacity-view.v1",
    status: "frozen-before-new-sampling-plan",
    frozenAt,
    sourceRegisterId: "S03",
    sourceEventId: "E003",
    duplicateOverlapAuditFingerprint: audit.auditFingerprint,
    duplicateOverlapAmendmentFingerprint: amendment.amendmentFingerprint,
    sourceRegisterFingerprint: audit.sourceRegisterFingerprint,
    capacityManifestFingerprint: audit.capacityManifestFingerprint,
    sourceCapacityLedgerArtifactFingerprint: audit.capacityLedgerArtifactFingerprint,
    sourceCapacityLedgerFingerprint: audit.capacityLedgerFingerprint,
    samplingPlanV4OutcomeFingerprint: audit.samplingPlanV4OutcomeFingerprint,
    policy: {
      equivalence: amendment.policy.equivalence,
      representative: amendment.policy.representative,
      conflictResult: amendment.policy.conflictResult,
    },
    counts: {
      sourceEligibleOccurrences: 270,
      uniqueCapacityUnits: units.length,
      excludedDuplicateOccurrences: units.reduce(
        (sum, unit) => sum + unit.duplicateCapacityUnitIds.length, 0,
      ),
      consensusUnits: units.filter((unit) => unit.highRiskReviewState === "consensus").length,
      uncertaintyWithheldUnits: units.filter(
        (unit) => unit.highRiskReviewState === "uncertainty-withheld",
      ).length,
      unitsWithAdmittedHighRiskStrata: units.filter(
        (unit) => unit.agreedHighRiskStrata.length > 0,
      ).length,
    },
    units,
    sourceContentStored: false,
    selectionPerformed: false,
    observationCodingPerformed: false,
    traitAdmission: "prohibited",
    runtimeActivation: "prohibited",
    nextAction: "freeze-sampling-plan-v5-against-unique-capacity-view",
  });
}

export async function loadS03UniqueCapacityView(projectRoot = process.cwd()) {
  const artifactText = await readFile(path.resolve(
    projectRoot, "research/s03-unique-capacity-view-v1.json",
  ), "utf8");
  const artifact = s03UniqueCapacityViewSchema.parse(JSON.parse(artifactText));
  const expected = await buildS03UniqueCapacityView(artifact.frozenAt, projectRoot);
  if (JSON.stringify(artifact) !== JSON.stringify(expected)) {
    throw new Error("Unique S03 capacity view is stale");
  }
  return { ...artifact, viewFingerprint: digest(artifactText) };
}

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
