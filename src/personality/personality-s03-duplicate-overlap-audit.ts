import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { loadPersonalityPreallocationCapacityManifestV1 } from
  "./personality-preallocation-capacity-manifest.js";
import { preallocationCapacityLedgerSchema } from
  "./personality-preallocation-capacity-ledger.js";
import { loadPersonalitySamplingPlanV4Outcome } from
  "./personality-sampling-plan-v4-outcome.js";

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const highRiskSchema = z.enum([
  "belief", "biography", "boundary", "contradiction", "grief-or-hurt", "humor",
  "identity-trait", "politics", "voice-adjacent", "workplace-sexual-boundary",
]);
const memberSchema = z.object({
  capacityUnitId: z.string().regex(/^C-S03-\d{4}$/u),
  sourceUnitOrdinal: z.number().int().nonnegative(),
  locator: z.string().regex(/^speaker-block-\d+$/u),
  highRiskReviewState: z.enum(["consensus", "uncertainty-withheld"]),
  agreedHighRiskStrata: z.array(highRiskSchema),
}).strict();
const duplicateGroupSchema = z.object({
  groupId: z.string().regex(/^DG-S03-\d{4}$/u),
  segmentFingerprint: sha256Schema,
  representativeCapacityUnitId: z.string().regex(/^C-S03-\d{4}$/u),
  representativeSourceUnitOrdinal: z.number().int().nonnegative(),
  memberCount: z.number().int().min(2),
  members: z.array(memberSchema).min(2),
  metadataConflict: z.boolean(),
  containsPriorUncertainty: z.boolean(),
  proposedHighRiskReviewState: z.enum(["consensus", "uncertainty-withheld"]),
  proposedAgreedHighRiskStrata: z.array(highRiskSchema),
  proposedWithheldCandidateStrata: z.array(highRiskSchema),
}).strict().superRefine((group, context) => {
  const ordered = [...group.members].sort(
    (left, right) => left.sourceUnitOrdinal - right.sourceUnitOrdinal ||
      left.capacityUnitId.localeCompare(right.capacityUnitId),
  );
  const tagSets = group.members.map(
    (member) => JSON.stringify([...member.agreedHighRiskStrata].sort()),
  );
  const conflict = new Set(tagSets).size > 1;
  const priorUncertainty = group.members.some(
    (member) => member.highRiskReviewState === "uncertainty-withheld",
  );
  const withheld = conflict || priorUncertainty;
  const candidateTags = [...new Set(group.members.flatMap(
    (member) => member.agreedHighRiskStrata,
  ))].sort();
  const expectedAdmitted = withheld ? [] : [...group.members[0]!.agreedHighRiskStrata].sort();
  const expectedWithheld = withheld ? candidateTags : [];
  if (group.memberCount !== group.members.length ||
      new Set(group.members.map((member) => member.capacityUnitId)).size !== group.members.length ||
      JSON.stringify(group.members) !== JSON.stringify(ordered) ||
      group.representativeCapacityUnitId !== ordered[0]!.capacityUnitId ||
      group.representativeSourceUnitOrdinal !== ordered[0]!.sourceUnitOrdinal ||
      group.metadataConflict !== conflict ||
      group.containsPriorUncertainty !== priorUncertainty ||
      group.proposedHighRiskReviewState !== (withheld ? "uncertainty-withheld" : "consensus") ||
      JSON.stringify(group.proposedAgreedHighRiskStrata) !== JSON.stringify(expectedAdmitted) ||
      JSON.stringify(group.proposedWithheldCandidateStrata) !== JSON.stringify(expectedWithheld)) {
    context.addIssue({ code: "custom", message: `${group.groupId} duplicate policy is inconsistent` });
  }
});

export const s03DuplicateOverlapAuditSchema = z.object({
  schemaVersion: z.literal("jolene.personality-s03-duplicate-overlap-audit.v1"),
  status: z.literal("prospective-machine-audit-awaiting-dual-review"),
  createdAt: z.string().datetime(),
  sourceRegisterId: z.literal("S03"),
  sourceEventId: z.literal("E003"),
  sourceRegisterFingerprint: sha256Schema,
  capacityManifestFingerprint: sha256Schema,
  capacityLedgerArtifactFingerprint: sha256Schema,
  capacityLedgerFingerprint: sha256Schema,
  samplingPlanV4OutcomeFingerprint: sha256Schema,
  policy: z.object({
    equivalence: z.literal("exact-canonical-segment-fingerprint"),
    representative: z.literal("lowest-source-unit-ordinal-then-capacity-unit-id"),
    consensusAdmission: z.literal(
      "all-members-consensus-and-identical-agreed-strata-else-withhold-entire-group",
    ),
    blindToFameQuotabilityAndTraitOutcome: z.literal(true),
  }).strict(),
  counts: z.object({
    eligibleOccurrences: z.literal(270),
    uniqueFingerprintGroups: z.literal(133),
    duplicateFingerprintGroups: z.literal(133),
    duplicateOccurrencesBeyondRepresentative: z.literal(137),
    cleanConsensusGroups: z.literal(70),
    uncertaintyWithheldGroups: z.literal(63),
    metadataConflictGroups: z.literal(41),
    groupsContainingPriorUncertainty: z.literal(28),
    proposedAdmittedHighRiskGroups: z.literal(49),
  }).strict(),
  groups: z.array(duplicateGroupSchema).length(133),
  sourceContentStored: z.literal(false),
  selectionPerformed: z.literal(false),
  observationCodingPerformed: z.literal(false),
  traitAdmission: z.literal("prohibited"),
  runtimeActivation: z.literal("prohibited"),
}).strict().superRefine((audit, context) => {
  const memberIds = audit.groups.flatMap(
    (group) => group.members.map((member) => member.capacityUnitId),
  );
  const fingerprints = audit.groups.map((group) => group.segmentFingerprint);
  if (new Set(memberIds).size !== 270 || memberIds.length !== 270 ||
      new Set(fingerprints).size !== 133) {
    context.addIssue({ code: "custom", message: "S03 duplicate groups do not partition capacity" });
  }
});

export type S03DuplicateOverlapAudit = z.infer<typeof s03DuplicateOverlapAuditSchema>;

export async function buildS03DuplicateOverlapAudit(
  createdAt: string,
  projectRoot = process.cwd(),
): Promise<S03DuplicateOverlapAudit> {
  const [capacity, outcome] = await Promise.all([
    loadPersonalityPreallocationCapacityManifestV1(projectRoot),
    loadPersonalitySamplingPlanV4Outcome(projectRoot),
  ]);
  const capacityEntry = capacity.ledgers.find((entry) => entry.sourceRegisterId === "S03");
  if (!capacityEntry) throw new Error("S03 capacity entry is missing");
  const capacityText = await readFile(path.resolve(projectRoot, capacityEntry.ledgerArtifact), "utf8");
  const ledger = preallocationCapacityLedgerSchema.parse(JSON.parse(capacityText));
  const byFingerprint = new Map<string, typeof ledger.eligibleUnits>();
  for (const unit of ledger.eligibleUnits) {
    const members = byFingerprint.get(unit.segmentFingerprint) ?? [];
    byFingerprint.set(unit.segmentFingerprint, [...members, unit]);
  }
  const groups = [...byFingerprint.entries()].sort(([left], [right]) => left.localeCompare(right))
    .map(([segmentFingerprint, rawMembers], index) => {
      const members = [...rawMembers].sort(
        (left, right) => left.sourceUnitOrdinal - right.sourceUnitOrdinal ||
          left.unitId.localeCompare(right.unitId),
      );
      const tagSets = members.map((member) => JSON.stringify([...member.agreedHighRiskStrata].sort()));
      const metadataConflict = new Set(tagSets).size > 1;
      const containsPriorUncertainty = members.some(
        (member) => member.highRiskReviewState === "uncertainty-withheld",
      );
      const withheld = metadataConflict || containsPriorUncertainty;
      const candidateTags = [...new Set(members.flatMap((member) => member.agreedHighRiskStrata))]
        .sort() as z.infer<typeof highRiskSchema>[];
      return {
        groupId: `DG-S03-${String(index + 1).padStart(4, "0")}`,
        segmentFingerprint,
        representativeCapacityUnitId: members[0]!.unitId,
        representativeSourceUnitOrdinal: members[0]!.sourceUnitOrdinal,
        memberCount: members.length,
        members: members.map((member) => ({
          capacityUnitId: member.unitId,
          sourceUnitOrdinal: member.sourceUnitOrdinal,
          locator: member.locator.label,
          highRiskReviewState: member.highRiskReviewState,
          agreedHighRiskStrata: [...member.agreedHighRiskStrata].sort(),
        })),
        metadataConflict,
        containsPriorUncertainty,
        proposedHighRiskReviewState: withheld ? "uncertainty-withheld" as const : "consensus" as const,
        proposedAgreedHighRiskStrata: withheld ? [] :
          [...members[0]!.agreedHighRiskStrata].sort(),
        proposedWithheldCandidateStrata: withheld ? candidateTags : [],
      };
    });
  const counts = {
    eligibleOccurrences: ledger.eligibleUnits.length,
    uniqueFingerprintGroups: groups.length,
    duplicateFingerprintGroups: groups.filter((group) => group.memberCount > 1).length,
    duplicateOccurrencesBeyondRepresentative: groups.reduce(
      (sum, group) => sum + group.memberCount - 1, 0,
    ),
    cleanConsensusGroups: groups.filter(
      (group) => group.proposedHighRiskReviewState === "consensus",
    ).length,
    uncertaintyWithheldGroups: groups.filter(
      (group) => group.proposedHighRiskReviewState === "uncertainty-withheld",
    ).length,
    metadataConflictGroups: groups.filter((group) => group.metadataConflict).length,
    groupsContainingPriorUncertainty: groups.filter(
      (group) => group.containsPriorUncertainty,
    ).length,
    proposedAdmittedHighRiskGroups: groups.filter(
      (group) => group.proposedAgreedHighRiskStrata.length > 0,
    ).length,
  };
  return s03DuplicateOverlapAuditSchema.parse({
    schemaVersion: "jolene.personality-s03-duplicate-overlap-audit.v1",
    status: "prospective-machine-audit-awaiting-dual-review",
    createdAt,
    sourceRegisterId: "S03", sourceEventId: "E003",
    sourceRegisterFingerprint: capacity.sourceRegisterFingerprint,
    capacityManifestFingerprint: capacity.manifestFingerprint,
    capacityLedgerArtifactFingerprint: capacityEntry.ledgerArtifactFingerprint,
    capacityLedgerFingerprint: capacityEntry.ledgerFingerprint,
    samplingPlanV4OutcomeFingerprint: outcome.outcomeFingerprint,
    policy: {
      equivalence: "exact-canonical-segment-fingerprint",
      representative: "lowest-source-unit-ordinal-then-capacity-unit-id",
      consensusAdmission:
        "all-members-consensus-and-identical-agreed-strata-else-withhold-entire-group",
      blindToFameQuotabilityAndTraitOutcome: true,
    },
    counts, groups,
    sourceContentStored: false, selectionPerformed: false,
    observationCodingPerformed: false, traitAdmission: "prohibited",
    runtimeActivation: "prohibited",
  });
}

export async function loadS03DuplicateOverlapAudit(projectRoot = process.cwd()) {
  const auditText = await readFile(path.resolve(
    projectRoot, "research/s03-duplicate-overlap-audit-v1.json",
  ), "utf8");
  const audit = s03DuplicateOverlapAuditSchema.parse(JSON.parse(auditText));
  const expected = await buildS03DuplicateOverlapAudit(audit.createdAt, projectRoot);
  if (JSON.stringify(audit) !== JSON.stringify(expected)) {
    throw new Error("S03 duplicate-overlap audit is stale");
  }
  return { ...audit, auditFingerprint: digest(auditText) };
}

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
