import { createHash } from "node:crypto";

import { z } from "zod";

import {
  personalityAdmissionAuditV1Schema,
  type PersonalityAdmissionAuditV1,
} from "./personality-admission-audit-v1.js";
import {
  personalityTurnSchema,
  traitFamilySchema,
  type PersonalityCorpusV2,
  type PersonalityTurn,
} from "./personality-corpus-contract.js";

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const observationIdSchema = z.string().regex(/^T\d{3}$/u);

const traitNodeSchema = z.object({
  nodeType: z.literal("trait"),
  traitFamilyId: traitFamilySchema,
  decision: z.enum(["admitted", "deferred-insufficient-evidence"]),
  eligibleSupportCount: z.number().int().nonnegative(),
  sourceEvents: z.number().int().nonnegative(),
  settingFamilies: z.number().int().nonnegative(),
  timeBands: z.number().int().nonnegative(),
  decisionReason: z.string().min(20),
  ownerDecision: z.enum(["approved", "not-reached"]),
  originalDesignedRule: z.string().min(20).nullable(),
}).strict();

const observationNodeSchema = z.object({
  nodeType: z.literal("observation-reference"),
  observationId: observationIdSchema,
  sourceEventId: z.string().regex(/^E\d{3}$/u),
  date: z.string().regex(/^\d{4}(?:-\d{2}-\d{2})?$/u),
  timeBand: z.string().min(1),
  settingFamily: z.string().min(1),
  confidence: z.enum(["high", "low", "medium"]),
  observationEvidenceClass: z.literal("observed"),
  traitEvidenceClass: z.enum(["inferred", "rejected"]),
  adaptationEvidenceClass: z.enum(["designed", "rejected"]),
}).strict();

const constraintNodeSchema = z.object({
  nodeType: z.literal("anti-caricature-constraint"),
  constraintId: z.string().regex(/^AC-\d{2}$/u),
  rule: z.string().min(20),
}).strict();

const evidenceEdgeSchema = z.object({
  edgeType: z.enum(["supports", "counterexample-to"]),
  fromObservationId: observationIdSchema,
  toTraitFamilyId: traitFamilySchema,
}).strict();

const constraintEdgeSchema = z.object({
  edgeType: z.literal("constrains"),
  fromConstraintId: z.string().regex(/^AC-\d{2}$/u),
  toTraitFamilyId: traitFamilySchema,
}).strict();

export const personalityCharacterGraphV1Schema = z.object({
  schemaVersion: z.literal("jolene.personality-character-graph.v1"),
  status: z.literal("reviewed-non-activating"),
  generatedAt: z.string().datetime(),
  sourceBindings: z.object({
    corpusSchemaVersion: z.literal("jolene.personality-corpus.v2"),
    corpusFingerprint: sha256Schema,
    admissionAuditSchemaVersion: z.literal("jolene.personality-admission-audit.v1"),
    admissionAuditFingerprint: sha256Schema,
  }).strict(),
  decisionSummary: z.object({
    admittedTraits: z.literal(1),
    deferredTraits: z.literal(7),
    referencedObservations: z.number().int().positive(),
    antiCaricatureConstraints: z.number().int().min(6),
    runtimeActivation: z.literal("prohibited"),
  }).strict(),
  traitNodes: z.array(traitNodeSchema).length(8),
  observationNodes: z.array(observationNodeSchema).min(1),
  constraintNodes: z.array(constraintNodeSchema).min(6),
  evidenceEdges: z.array(evidenceEdgeSchema).min(1),
  constraintEdges: z.array(constraintEdgeSchema).min(1),
  graphFingerprint: sha256Schema,
}).strict();

export type PersonalityCharacterGraphV1 = z.infer<typeof personalityCharacterGraphV1Schema>;

const forbiddenSourceContentKeys = new Set([
  "alternativeInterpretation",
  "doNotCopy",
  "excerpt",
  "locator",
  "paraphrase",
  "segmentFingerprint",
  "sourceUrl",
]);

export function buildPersonalityCharacterGraphV1(
  corpusInput: PersonalityCorpusV2,
  auditInput: PersonalityAdmissionAuditV1,
  admissionAuditFingerprint: `sha256:${string}`,
): PersonalityCharacterGraphV1 {
  const audit = personalityAdmissionAuditV1Schema.parse(auditInput);
  const turns = corpusInput.turns.map((turn) => personalityTurnSchema.parse(turn));
  assertUnique(turns.map((turn) => turn.observationId), "corpus observation");

  const turnsById = new Map(turns.map((turn) => [turn.observationId, turn]));
  const referencedObservationIds = [...new Set(audit.traitDecisions.flatMap((decision) => [
    ...decision.supportingObservationIds,
    ...decision.counterexampleObservationIds,
  ]))].sort();
  for (const observationId of referencedObservationIds) {
    if (!turnsById.has(observationId)) {
      throw new Error(`Character graph references unknown observation ${observationId}`);
    }
  }

  const traitNodes = [...audit.traitDecisions]
    .sort((left, right) => left.traitFamilyId.localeCompare(right.traitFamilyId))
    .map((decision) => ({
      nodeType: "trait" as const,
      traitFamilyId: decision.traitFamilyId,
      decision: decision.decision,
      eligibleSupportCount: decision.eligibleSupportCount,
      sourceEvents: decision.sourceEvents,
      settingFamilies: decision.settingFamilies,
      timeBands: decision.timeBands,
      decisionReason: decision.decisionReason,
      ownerDecision: decision.ownerDecision,
      originalDesignedRule: decision.originalDesignedRule,
    }));
  const observationNodes = referencedObservationIds.map((observationId) =>
    toObservationNode(turnsById.get(observationId)!),
  );
  const constraintNodes = audit.antiCaricatureRules.map((rule, index) => ({
    nodeType: "anti-caricature-constraint" as const,
    constraintId: `AC-${String(index + 1).padStart(2, "0")}`,
    rule,
  }));
  const evidenceEdges = traitNodes.flatMap((traitNode) => {
    const decision = audit.traitDecisions.find(
      (candidate) => candidate.traitFamilyId === traitNode.traitFamilyId,
    )!;
    return [
      ...decision.supportingObservationIds.map((fromObservationId) => ({
        edgeType: "supports" as const,
        fromObservationId,
        toTraitFamilyId: decision.traitFamilyId,
      })),
      ...decision.counterexampleObservationIds.map((fromObservationId) => ({
        edgeType: "counterexample-to" as const,
        fromObservationId,
        toTraitFamilyId: decision.traitFamilyId,
      })),
    ].sort(compareEvidenceEdges);
  });
  const constraintEdges = constraintNodes.flatMap((constraint) =>
    traitNodes.map((trait) => ({
      edgeType: "constrains" as const,
      fromConstraintId: constraint.constraintId,
      toTraitFamilyId: trait.traitFamilyId,
    })),
  );
  const graphWithoutFingerprint = {
    schemaVersion: "jolene.personality-character-graph.v1" as const,
    status: "reviewed-non-activating" as const,
    generatedAt: audit.completedAt,
    sourceBindings: {
      corpusSchemaVersion: corpusInput.schemaVersion,
      corpusFingerprint: audit.corpusFingerprint,
      admissionAuditSchemaVersion: audit.schemaVersion,
      admissionAuditFingerprint,
    },
    decisionSummary: {
      admittedTraits: 1 as const,
      deferredTraits: 7 as const,
      referencedObservations: referencedObservationIds.length,
      antiCaricatureConstraints: constraintNodes.length,
      runtimeActivation: "prohibited" as const,
    },
    traitNodes,
    observationNodes,
    constraintNodes,
    evidenceEdges,
    constraintEdges,
  };
  return personalityCharacterGraphV1Schema.parse({
    ...graphWithoutFingerprint,
    graphFingerprint: fingerprintGraph(graphWithoutFingerprint),
  });
}

export function validatePersonalityCharacterGraphV1(
  graphInput: unknown,
  corpus: PersonalityCorpusV2,
  audit: PersonalityAdmissionAuditV1,
  admissionAuditFingerprint: `sha256:${string}`,
): PersonalityCharacterGraphV1 {
  assertNoSourceContentKeys(graphInput);
  const graph = personalityCharacterGraphV1Schema.parse(graphInput);
  const expected = buildPersonalityCharacterGraphV1(corpus, audit, admissionAuditFingerprint);
  if (JSON.stringify(graph) !== JSON.stringify(expected)) {
    throw new Error("Character graph does not match its reviewed source artifacts");
  }
  return graph;
}

function toObservationNode(turn: PersonalityTurn) {
  return {
    nodeType: "observation-reference" as const,
    observationId: turn.observationId,
    sourceEventId: turn.sourceEventId,
    date: turn.date,
    timeBand: turn.timeBand,
    settingFamily: turn.settingFamily,
    confidence: turn.confidence,
    observationEvidenceClass: turn.observationEvidenceClass,
    traitEvidenceClass: turn.traitEvidenceClass,
    adaptationEvidenceClass: turn.adaptationEvidenceClass,
  };
}

function compareEvidenceEdges(
  left: { fromObservationId: string; edgeType: string },
  right: { fromObservationId: string; edgeType: string },
) {
  return left.fromObservationId.localeCompare(right.fromObservationId) ||
    left.edgeType.localeCompare(right.edgeType);
}

function fingerprintGraph(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function assertNoSourceContentKeys(value: unknown, path = "graph"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSourceContentKeys(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenSourceContentKeys.has(key)) {
      throw new Error(`Character graph contains prohibited source-content field ${path}.${key}`);
    }
    assertNoSourceContentKeys(child, `${path}.${key}`);
  }
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label}`);
}
