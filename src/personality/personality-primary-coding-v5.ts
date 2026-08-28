import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import {
  personalityTurnSchema,
  researchContextSchema,
  type PersonalityTurn,
} from "./personality-corpus-contract.js";
import { loadPersonalitySelectionArtifactsV5 } from
  "./personality-selection-ledgers-v5.js";
import { loadPersonalitySourceRegisterV3 } from "./personality-source-register-v3.js";

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);

export const personalityPrimaryCodingArtifactV5Schema = z.object({
  schemaVersion: z.literal("jolene.personality-primary-coding.v5"),
  status: z.literal("primary-coded-awaiting-independent-review"),
  codedAt: z.string().datetime(),
  selectionManifestFingerprint: sha256Schema,
  samplingPlanFingerprint: sha256Schema,
  sourceRegisterFingerprint: sha256Schema,
  primaryReviewer: z.object({
    reviewerId: z.string().regex(/^[a-z0-9][a-z0-9-]{2,63}$/u),
    reviewerType: z.enum(["ai", "human"]),
    tool: z.string().min(1),
    modelVersion: z.string().min(1).nullable(),
  }).strict(),
  turns: z.array(personalityTurnSchema).length(120),
  rights: z.object({
    repositoryStorage: z.literal("metadata-and-paraphrase-only"),
    excerpts: z.literal("prohibited"),
    sourceContentStored: z.literal(false),
    recognizableExpression: z.literal("prohibited"),
  }).strict(),
  selectionMutationPerformed: z.literal(false),
  independentReviewPerformed: z.literal(false),
  traitAdmission: z.literal("prohibited"),
  runtimeActivation: z.literal("prohibited"),
}).strict();

export type PersonalityPrimaryCodingArtifactV5 = z.infer<
  typeof personalityPrimaryCodingArtifactV5Schema
>;

export interface PersonalityPrimaryCodingValidationV5 {
  readonly turns: 120;
  readonly sources: 10;
  readonly researchContexts: 8;
  readonly rejectedTraitTurns: number;
  readonly rejectedAdaptationTurns: number;
  readonly artifactFingerprint: string;
  readonly runtimeActivation: "prohibited";
}

const prerequisiteCache = new Map<string, Promise<{
  readonly selection: Awaited<ReturnType<typeof loadPersonalitySelectionArtifactsV5>>;
  readonly register: Awaited<ReturnType<typeof loadPersonalitySourceRegisterV3>>;
}>>();

export function loadPersonalityPrimaryCodingPrerequisitesV5(projectRoot = process.cwd()) {
  const root = path.resolve(projectRoot);
  const cached = prerequisiteCache.get(root);
  if (cached) return cached;
  const loading = Promise.all([
    loadPersonalitySelectionArtifactsV5(root),
    loadPersonalitySourceRegisterV3(root),
  ]).then(([selection, register]) => ({ selection, register }));
  prerequisiteCache.set(root, loading);
  return loading;
}

export async function loadPersonalityPrimaryCodingArtifactV5(
  projectRoot = process.cwd(),
  artifactPath = path.resolve(projectRoot, "research/primary-coding-v5.json"),
): Promise<PersonalityPrimaryCodingValidationV5> {
  const text = await readFile(artifactPath, "utf8");
  const artifact = personalityPrimaryCodingArtifactV5Schema.parse(JSON.parse(text));
  const result = await validatePersonalityPrimaryCodingArtifactV5(artifact, projectRoot);
  return { ...result, artifactFingerprint: digest(text) };
}

export async function validatePersonalityPrimaryCodingArtifactV5(
  raw: PersonalityPrimaryCodingArtifactV5,
  projectRoot = process.cwd(),
): Promise<Omit<PersonalityPrimaryCodingValidationV5, "artifactFingerprint">> {
  const artifact = personalityPrimaryCodingArtifactV5Schema.parse(raw);
  const { selection, register } = await loadPersonalityPrimaryCodingPrerequisitesV5(projectRoot);
  if (artifact.selectionManifestFingerprint !== selection.manifestFingerprint ||
      artifact.sourceRegisterFingerprint !== register.registerFingerprint) {
    throw new Error("Primary coding prerequisite fingerprint mismatch");
  }
  const selected = selection.ledgers.flatMap((ledger) => ledger.selectedUnits.map((unit) => ({
    ledger,
    unit,
  })));
  if (artifact.samplingPlanFingerprint !== selected[0]?.ledger.samplingPlanFingerprint) {
    throw new Error("Primary coding sampling-plan fingerprint mismatch");
  }
  const sourceByEvent = new Map(register.events.map((source) => [source.sourceEventId, source]));
  const observationIds = new Set<string>();
  const paraphrases = new Set<string>();
  artifact.turns.forEach((turn, index) => {
    const expected = selected[index];
    if (!expected) throw new Error(`Unexpected primary observation ${turn.observationId}`);
    const expectedObservationId = `T${String(index + 1).padStart(3, "0")}`;
    const source = sourceByEvent.get(expected.ledger.sourceEventId);
    if (!source || turn.observationId !== expectedObservationId ||
        turn.sourceEventId !== expected.ledger.sourceEventId ||
        turn.sourceUrl !== source.url || turn.date !== source.date ||
        turn.timeBand !== source.timeBand || turn.settingFamily !== source.settingFamily ||
        turn.locator.kind !== expected.unit.locator.kind ||
        turn.locator.start !== expected.unit.locator.start ||
        turn.locator.end !== expected.unit.locator.end ||
        turn.locator.label !== expected.unit.locator.label ||
        turn.segmentFingerprint !== expected.unit.segmentFingerprint ||
        turn.sampleRuleId !== expected.unit.selectionRuleId ||
        !sameStrings(turn.sensitiveStrata, expected.unit.agreedHighRiskStrata)) {
      throw new Error(`Primary observation ${expectedObservationId} is not bound to frozen selection`);
    }
    if (turn.excerpt !== null || turn.primaryReviewer.reviewerId !== artifact.primaryReviewer.reviewerId ||
        turn.primaryReviewer.reviewerType !== artifact.primaryReviewer.reviewerType ||
        turn.primaryReviewer.tool !== artifact.primaryReviewer.tool ||
        turn.primaryReviewer.modelVersion !== artifact.primaryReviewer.modelVersion ||
        turn.primaryReviewer.codedAt !== artifact.codedAt) {
      throw new Error(`Primary observation ${expectedObservationId} has inconsistent coding provenance`);
    }
    if (observationIds.has(turn.observationId)) throw new Error("Duplicate primary observation ID");
    observationIds.add(turn.observationId);
    const paraphrase = normalize(turn.paraphrase);
    if (paraphrases.has(paraphrase)) throw new Error("Duplicate normalized primary paraphrase");
    paraphrases.add(paraphrase);
  });
  const sources = new Set(artifact.turns.map((turn) => turn.sourceEventId));
  if (sources.size !== 10) throw new Error("Primary coding must cover ten source events");
  for (const context of researchContextSchema.options) {
    const matching = artifact.turns.filter((turn) => turn.researchContext === context);
    if (matching.length < 5 || new Set(matching.map((turn) => turn.sourceEventId)).size < 2) {
      throw new Error(`Primary coding context coverage is insufficient for ${context}`);
    }
  }
  const rejectedTraitTurns = artifact.turns.filter(
    (turn) => turn.traitEvidenceClass === "rejected",
  ).length;
  const rejectedAdaptationTurns = artifact.turns.filter(
    (turn) => turn.adaptationEvidenceClass === "rejected",
  ).length;
  if (rejectedTraitTurns < 24 || rejectedAdaptationTurns < 24) {
    throw new Error("Primary coding lacks the precommitted negative/counterexample baseline");
  }
  return {
    turns: 120,
    sources: 10,
    researchContexts: 8,
    rejectedTraitTurns,
    rejectedAdaptationTurns,
    runtimeActivation: "prohibited",
  };
}

export function buildPrimaryCodingArtifactV5(options: {
  readonly codedAt: string;
  readonly selectionManifestFingerprint: string;
  readonly samplingPlanFingerprint: string;
  readonly sourceRegisterFingerprint: string;
  readonly primaryReviewer: PersonalityPrimaryCodingArtifactV5["primaryReviewer"];
  readonly turns: readonly PersonalityTurn[];
}): PersonalityPrimaryCodingArtifactV5 {
  return personalityPrimaryCodingArtifactV5Schema.parse({
    schemaVersion: "jolene.personality-primary-coding.v5",
    status: "primary-coded-awaiting-independent-review",
    ...options,
    rights: {
      repositoryStorage: "metadata-and-paraphrase-only",
      excerpts: "prohibited",
      sourceContentStored: false,
      recognizableExpression: "prohibited",
    },
    selectionMutationPerformed: false,
    independentReviewPerformed: false,
    traitAdmission: "prohibited",
    runtimeActivation: "prohibited",
  });
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function normalize(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/gu, " ").toLowerCase();
}

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
