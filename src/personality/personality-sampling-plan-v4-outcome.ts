import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { parse } from "yaml";
import { z } from "zod";

import { auditPersonalitySelectionPlanV4 } from "./personality-selection-ledgers-v4.js";
import { loadPersonalityPreallocationCapacityManifestV1 } from
  "./personality-preallocation-capacity-manifest.js";
import { loadPersonalitySamplingPlanV4 } from "./personality-sampling-plan-v4.js";

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const duplicateUnitSchema = z.object({
  sourceRegisterId: z.literal("S03"),
  capacityUnitId: z.string().regex(/^C-S03-\d{4}$/u),
  locator: z.string().regex(/^speaker-block-\d+$/u),
  selectionRuleId: z.enum(["SAM-001", "SAM-002"]),
}).strict();
const duplicateGroupSchema = z.object({
  segmentFingerprint: sha256Schema,
  units: z.array(duplicateUnitSchema).min(2),
}).strict();

export const samplingPlanV4OutcomeSchema = z.object({
  schemaVersion: z.literal("jolene.personality-sampling-plan-v4-outcome.v1"),
  status: z.literal("failed-before-selection-and-coding"),
  evaluatedAt: z.string().datetime(),
  samplingPlanFingerprint: sha256Schema,
  capacityManifestFingerprint: sha256Schema,
  candidateSelectedTurns: z.literal(120),
  failure: z.object({
    code: z.literal("duplicate-segment-fingerprints-in-candidate-selection"),
    sourceRegisterId: z.literal("S03"),
    duplicateGroups: z.array(duplicateGroupSchema).length(4),
    duplicateSelectedTurns: z.literal(8),
  }).strict(),
  committedSelectionLedgers: z.literal(0),
  selectionPerformed: z.literal(false),
  observationsCreated: z.literal(0),
  outcomeBasedReplacementPerformed: z.literal(false),
  requiredNextAction: z.literal(
    "prospective-duplicate-overlap-policy-and-new-sampling-plan-version",
  ),
  sourceContentStored: z.literal(false),
  runtimeActivation: z.literal("prohibited"),
}).strict();

export async function buildPersonalitySamplingPlanV4Outcome(
  evaluatedAt: string,
  projectRoot = process.cwd(),
) {
  const [audit, capacity, plan] = await Promise.all([
    auditPersonalitySelectionPlanV4(evaluatedAt, projectRoot),
    loadPersonalityPreallocationCapacityManifestV1(projectRoot),
    loadPersonalitySamplingPlanV4(projectRoot),
  ]);
  if (audit.selectionAccepted || audit.duplicateGroups.length !== 4 ||
      audit.duplicateSelectedTurns !== 8) {
    throw new Error("Sampling plan v4 duplicate-selection failure is no longer reproducible");
  }
  return samplingPlanV4OutcomeSchema.parse({
    schemaVersion: "jolene.personality-sampling-plan-v4-outcome.v1",
    status: "failed-before-selection-and-coding",
    evaluatedAt,
    samplingPlanFingerprint: plan.planFingerprint,
    capacityManifestFingerprint: capacity.manifestFingerprint,
    candidateSelectedTurns: audit.candidateSelectedTurns,
    failure: {
      code: "duplicate-segment-fingerprints-in-candidate-selection",
      sourceRegisterId: "S03",
      duplicateGroups: audit.duplicateGroups,
      duplicateSelectedTurns: audit.duplicateSelectedTurns,
    },
    committedSelectionLedgers: 0,
    selectionPerformed: false,
    observationsCreated: 0,
    outcomeBasedReplacementPerformed: false,
    requiredNextAction: "prospective-duplicate-overlap-policy-and-new-sampling-plan-version",
    sourceContentStored: false,
    runtimeActivation: "prohibited",
  });
}

export async function loadPersonalitySamplingPlanV4Outcome(projectRoot = process.cwd()) {
  const outcomeText = await readFile(path.resolve(
    projectRoot, "research/sampling-plan-v4-outcome.yaml",
  ), "utf8");
  const outcome = samplingPlanV4OutcomeSchema.parse(parse(outcomeText));
  const expected = await buildPersonalitySamplingPlanV4Outcome(outcome.evaluatedAt, projectRoot);
  if (JSON.stringify(outcome) !== JSON.stringify(expected)) {
    throw new Error("Sampling plan v4 failure outcome is stale");
  }
  return { ...outcome, outcomeFingerprint: digest(outcomeText) };
}

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
