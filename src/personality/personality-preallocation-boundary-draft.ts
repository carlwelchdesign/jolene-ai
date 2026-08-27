import { createHash } from "node:crypto";

import { z } from "zod";

import type { loadPersonalitySamplingBoundaryProtocolV1 } from
  "./personality-sampling-boundary-protocol.js";
import type { loadPersonalitySourceRegisterV3 } from "./personality-source-register-v3.js";

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const locatorSchema = z.object({
  kind: z.enum(["paragraph-index", "speaker-block-index", "pair-index"]),
  start: z.number().int().nonnegative(), end: z.number().int().nonnegative(),
  label: z.string().regex(/^(?:paragraph|speaker-block|pair)-\d+(?:-\d+)?$/),
}).strict().refine((locator) => locator.end >= locator.start,
  "Boundary-draft locator is reversed");
const exclusionReasonSchema = z.enum([
  "interviewer-or-other-speaker", "not-atomic", "speaker-attribution-unclear",
]);

export const preallocationBoundaryDraftSchema = z.object({
  schemaVersion: z.literal("jolene.personality-preallocation-boundary-draft.v1"),
  status: z.literal("machine-generated-awaiting-dual-review-and-tags"),
  generatedAt: z.string().datetime(),
  generatorId: z.literal("html-boundary-generator-v1"),
  sourceRegisterFingerprint: sha256Schema,
  boundaryProtocolFingerprint: sha256Schema,
  highRiskTaxonomyFingerprint: sha256Schema,
  sourceRegisterId: z.enum(["S02", "S03", "S05", "S13", "S19", "S20"]),
  sourceEventId: z.string().regex(/^E\d{3}$/),
  sourceContentFingerprint: sha256Schema,
  segmentationRule: z.enum([
    "cnn-speaker-label-blocks-v1", "interview-speaker-label-blocks-v1",
    "paragraph-speaker-blocks-v1", "vanity-proust-answer-pairs-v1",
  ]),
  sourceBoundaryUnitCount: z.number().int().positive(),
  eligibleUnits: z.array(z.object({
    unitId: z.string().regex(/^C-S\d{2}-\d{4}$/),
    sourceUnitOrdinal: z.number().int().nonnegative(), locator: locatorSchema,
    segmentFingerprint: sha256Schema,
  }).strict()),
  excludedRanges: z.array(z.object({
    exclusionId: z.string().regex(/^CX-S\d{2}-\d{4}$/),
    sourceUnitStart: z.number().int().nonnegative(),
    sourceUnitEnd: z.number().int().nonnegative(), locator: locatorSchema,
    segmentFingerprint: sha256Schema, reason: exclusionReasonSchema,
  }).strict()),
  sourceContentStored: z.literal(false),
  semanticReviewPerformed: z.literal(false),
  independentReviewPerformed: z.literal(false),
  selectionPerformed: z.literal(false),
}).strict();

export type PreallocationBoundaryDraft = z.infer<typeof preallocationBoundaryDraftSchema>;
type RegisterV3 = Awaited<ReturnType<typeof loadPersonalitySourceRegisterV3>>;
type Protocol = Awaited<ReturnType<typeof loadPersonalitySamplingBoundaryProtocolV1>>;

const expectedRules: Readonly<Record<
  PreallocationBoundaryDraft["sourceRegisterId"],
  PreallocationBoundaryDraft["segmentationRule"]
>> = {
  S02: "paragraph-speaker-blocks-v1",
  S03: "cnn-speaker-label-blocks-v1",
  S05: "paragraph-speaker-blocks-v1",
  S13: "paragraph-speaker-blocks-v1",
  S19: "interview-speaker-label-blocks-v1",
  S20: "vanity-proust-answer-pairs-v1",
};
const expectedLocatorKinds: Readonly<Record<
  PreallocationBoundaryDraft["sourceRegisterId"],
  PreallocationBoundaryDraft["eligibleUnits"][number]["locator"]["kind"]
>> = {
  S02: "paragraph-index", S03: "speaker-block-index", S05: "paragraph-index",
  S13: "paragraph-index", S19: "speaker-block-index", S20: "pair-index",
};

export function validatePreallocationBoundaryDraft(
  register: RegisterV3,
  protocol: Protocol,
  input: unknown,
) {
  const draft = preallocationBoundaryDraftSchema.parse(input);
  const source = register.events.find((event) => event.sourceRegisterId === draft.sourceRegisterId);
  if (draft.sourceRegisterFingerprint !== register.registerFingerprint ||
      draft.boundaryProtocolFingerprint !== protocol.protocolFingerprint ||
      draft.highRiskTaxonomyFingerprint !== protocol.highRiskTaxonomyFingerprint) {
    throw new Error(`${draft.sourceRegisterId} boundary-draft prerequisites are stale`);
  }
  if (!source || source.accessState !== "coding-ready" ||
      source.sourceEventId !== draft.sourceEventId ||
      source.sourceContentFingerprint !== draft.sourceContentFingerprint) {
    throw new Error(`${draft.sourceRegisterId} boundary-draft provenance mismatch`);
  }
  if (draft.segmentationRule !== expectedRules[draft.sourceRegisterId]) {
    throw new Error(`${draft.sourceRegisterId} boundary-draft segmentation rule mismatch`);
  }
  const expectedLocatorKind = expectedLocatorKinds[draft.sourceRegisterId];
  if (draft.eligibleUnits.some((unit) => unit.locator.kind !== expectedLocatorKind) ||
      draft.excludedRanges.some((range) => range.locator.kind !== expectedLocatorKind)) {
    throw new Error(`${draft.sourceRegisterId} boundary-draft locator kind mismatch`);
  }
  if (draft.eligibleUnits.some((unit) => !unit.unitId.startsWith(
    `C-${draft.sourceRegisterId}-`,
  )) || draft.excludedRanges.some((range) => !range.exclusionId.startsWith(
    `CX-${draft.sourceRegisterId}-`,
  ))) {
    throw new Error(`${draft.sourceRegisterId} boundary-draft ID prefix mismatch`);
  }
  assertUnique(draft.eligibleUnits.map((unit) => unit.unitId), "boundary-draft unit ID");
  assertUnique(draft.excludedRanges.map((range) => range.exclusionId),
    "boundary-draft exclusion ID");
  const coverage = new Uint8Array(draft.sourceBoundaryUnitCount);
  for (const unit of draft.eligibleUnits) mark(coverage, unit.sourceUnitOrdinal, unit.sourceUnitOrdinal);
  for (const range of draft.excludedRanges) mark(coverage, range.sourceUnitStart, range.sourceUnitEnd);
  if (coverage.some((value) => value !== 1)) {
    throw new Error(`${draft.sourceRegisterId} boundary-draft coverage is missing or overlapping`);
  }
  return {
    sourceRegisterId: draft.sourceRegisterId,
    boundaryUnits: draft.sourceBoundaryUnitCount,
    eligibleUnits: draft.eligibleUnits.length,
    excludedRanges: draft.excludedRanges.length,
    draftFingerprint: fingerprint(draft),
    semanticReviewPerformed: draft.semanticReviewPerformed,
    independentReviewPerformed: draft.independentReviewPerformed,
    selectionPerformed: draft.selectionPerformed,
  };
}

function mark(coverage: Uint8Array, start: number, end: number) {
  if (start < 0 || end < start || end >= coverage.length) {
    throw new Error("Boundary-draft unit is outside boundary");
  }
  for (let index = start; index <= end; index += 1) {
    coverage[index] = (coverage[index] ?? 0) + 1;
  }
}

function assertUnique(values: readonly string[], label: string) {
  if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label}`);
}

function fingerprint(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}
