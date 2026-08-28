import { createHash } from "node:crypto";

import { z } from "zod";

import type { PreallocationBoundaryDraft } from
  "./personality-preallocation-boundary-draft.js";

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const sourceIdSchema = z.enum(["S02", "S03", "S05", "S13", "S19", "S20"]);

export const htmlLedgerFingerprintMapSchema = z.object({
  schemaVersion: z.literal("jolene.personality-html-ledger-fingerprint-map.v1"),
  sourceRegisterId: sourceIdSchema,
  sourceContentFingerprint: sha256Schema,
  boundaryDraftFingerprint: sha256Schema,
  records: z.array(z.object({
    recordId: z.string().regex(/^C(?:X)?-S\d{2}-\d{4}$/u),
    locator: z.string(),
    boundarySegmentFingerprint: sha256Schema,
    ledgerSegmentFingerprint: sha256Schema,
  }).strict()),
  sourceContentStored: z.literal(false),
  selectionPerformed: z.literal(false),
  observationCodingPerformed: z.literal(false),
  runtimeActivation: z.literal("prohibited"),
}).strict();

export type HtmlLedgerFingerprintMap = z.infer<typeof htmlLedgerFingerprintMapSchema>;

export function buildHtmlLedgerFingerprintMap(
  draft: PreallocationBoundaryDraft,
  boundaryDraftText: string,
): HtmlLedgerFingerprintMap {
  const records = [
    ...draft.eligibleUnits.map((unit) => ({
      recordId: unit.unitId,
      locator: unit.locator.label,
      boundarySegmentFingerprint: unit.segmentFingerprint,
      ledgerSegmentFingerprint: unit.segmentFingerprint,
    })),
    ...draft.excludedRanges.map((range) => ({
      recordId: range.exclusionId,
      locator: range.locator.label,
      boundarySegmentFingerprint: range.segmentFingerprint,
      ledgerSegmentFingerprint: range.segmentFingerprint,
    })),
  ].sort((left, right) => left.recordId.localeCompare(right.recordId));
  return htmlLedgerFingerprintMapSchema.parse({
    schemaVersion: "jolene.personality-html-ledger-fingerprint-map.v1",
    sourceRegisterId: draft.sourceRegisterId,
    sourceContentFingerprint: draft.sourceContentFingerprint,
    boundaryDraftFingerprint: digestHtmlLedgerArtifact(boundaryDraftText),
    records,
    sourceContentStored: false,
    selectionPerformed: false,
    observationCodingPerformed: false,
    runtimeActivation: "prohibited",
  });
}

export function digestHtmlLedgerArtifact(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
