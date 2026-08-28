import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { parse } from "yaml";
import { z } from "zod";

import { loadPersonalityHtmlCapacityLedgersV1 } from
  "./personality-html-capacity-ledgers.js";
import { loadPersonalityPdfCapacityLedgersV1 } from
  "./personality-pdf-capacity-ledgers.js";
import { loadPersonalitySamplingBoundaryProtocolV1 } from
  "./personality-sampling-boundary-protocol.js";
import { loadPersonalitySourceRegisterV3 } from "./personality-source-register-v3.js";

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const sourceIdSchema = z.enum([
  "S02", "S03", "S04", "S05", "S08", "S09", "S13", "S18", "S19", "S20",
]);
const totalSchema = z.object({
  sources: z.literal(10),
  boundaryUnits: z.number().int().positive(),
  eligibleUnits: z.number().int().positive(),
  excludedUnits: z.number().int().nonnegative(),
  excludedRanges: z.number().int().nonnegative(),
  agreedHighRiskUnits: z.number().int().nonnegative(),
  uncertainHighRiskUnits: z.number().int().nonnegative(),
}).strict();
const ledgerEntrySchema = z.object({
  sourceRegisterId: sourceIdSchema,
  sourceEventId: z.string().regex(/^E\d{3}$/u),
  medium: z.enum(["html", "pdf"]),
  ledgerArtifact: z.string().regex(
    /^research\/preallocation-capacity-ledgers-v1\/source-S\d{2}\.json$/u,
  ),
  ledgerArtifactFingerprint: sha256Schema,
  ledgerFingerprint: sha256Schema,
  boundaryUnits: z.number().int().positive(),
  eligibleUnits: z.number().int().positive(),
  excludedUnits: z.number().int().nonnegative(),
  excludedRanges: z.number().int().nonnegative(),
  agreedHighRiskUnits: z.number().int().nonnegative(),
  uncertainHighRiskUnits: z.number().int().nonnegative(),
}).strict();

export const preallocationCapacityManifestSchema = z.object({
  schemaVersion: z.literal("jolene.personality-preallocation-capacity-manifest.v1"),
  status: z.literal("all-coding-ready-sources-independently-reviewed-before-allocation"),
  frozenAt: z.string().datetime(),
  sourceRegisterFingerprint: sha256Schema,
  boundaryProtocolFingerprint: sha256Schema,
  highRiskTaxonomyFingerprint: sha256Schema,
  pdfReviewEvidenceFingerprint: sha256Schema,
  htmlReviewEvidenceFingerprint: sha256Schema,
  ledgers: z.array(ledgerEntrySchema).length(10),
  totals: totalSchema,
  sourceContentStored: z.literal(false),
  frozenBeforeAllocation: z.literal(true),
  selectionPerformed: z.literal(false),
  observationCodingPerformed: z.literal(false),
  traitAdmission: z.literal("prohibited"),
  runtimeActivation: z.literal("prohibited"),
}).strict().superRefine((manifest, context) => {
  if (new Set(manifest.ledgers.map((entry) => entry.sourceRegisterId)).size !== 10) {
    context.addIssue({ code: "custom", message: "Capacity manifest source IDs are duplicated" });
  }
  const expectedPdf = new Set(["S04", "S08", "S09", "S18"]);
  for (const entry of manifest.ledgers) {
    if (entry.boundaryUnits !== entry.eligibleUnits + entry.excludedUnits ||
        entry.ledgerArtifact !==
          `research/preallocation-capacity-ledgers-v1/source-${entry.sourceRegisterId}.json` ||
        entry.medium !== (expectedPdf.has(entry.sourceRegisterId) ? "pdf" : "html")) {
      context.addIssue({
        code: "custom", message: `${entry.sourceRegisterId} capacity manifest entry is inconsistent`,
      });
    }
  }
  const computed = manifest.ledgers.reduce((sum, entry) => ({
    sources: 10,
    boundaryUnits: sum.boundaryUnits + entry.boundaryUnits,
    eligibleUnits: sum.eligibleUnits + entry.eligibleUnits,
    excludedUnits: sum.excludedUnits + entry.excludedUnits,
    excludedRanges: sum.excludedRanges + entry.excludedRanges,
    agreedHighRiskUnits: sum.agreedHighRiskUnits + entry.agreedHighRiskUnits,
    uncertainHighRiskUnits: sum.uncertainHighRiskUnits + entry.uncertainHighRiskUnits,
  }), {
    sources: 10, boundaryUnits: 0, eligibleUnits: 0, excludedUnits: 0,
    excludedRanges: 0, agreedHighRiskUnits: 0, uncertainHighRiskUnits: 0,
  });
  if (JSON.stringify(computed) !== JSON.stringify(manifest.totals)) {
    context.addIssue({ code: "custom", message: "Capacity manifest totals are inconsistent" });
  }
});

export type PreallocationCapacityManifest = z.infer<typeof preallocationCapacityManifestSchema>;

export async function buildPersonalityPreallocationCapacityManifestV1(
  frozenAt: string,
  projectRoot = process.cwd(),
): Promise<PreallocationCapacityManifest> {
  const [register, protocol, pdf, html] = await Promise.all([
    loadPersonalitySourceRegisterV3(projectRoot),
    loadPersonalitySamplingBoundaryProtocolV1(projectRoot),
    loadPersonalityPdfCapacityLedgersV1(projectRoot),
    loadPersonalityHtmlCapacityLedgersV1(projectRoot),
  ]);
  const codingReady = register.events.filter((event) => event.accessState === "coding-ready")
    .map((event) => event.sourceRegisterId).sort();
  const summaries = [
    ...pdf.ledgers.map((summary) => ({ medium: "pdf" as const, summary })),
    ...html.ledgers.map((summary) => ({ medium: "html" as const, summary })),
  ].sort((left, right) =>
    left.summary.sourceRegisterId.localeCompare(right.summary.sourceRegisterId)
  );
  const observed = summaries.map((item) => item.summary.sourceRegisterId);
  if (JSON.stringify(observed) !== JSON.stringify(codingReady) || observed.length !== 10) {
    throw new Error("Capacity manifest does not cover every coding-ready source exactly once");
  }
  const ledgers = await Promise.all(summaries.map(async ({ medium, summary }) => {
    const ledgerArtifact =
      `research/preallocation-capacity-ledgers-v1/source-${summary.sourceRegisterId}.json`;
    const ledgerText = await readFile(path.resolve(projectRoot, ledgerArtifact), "utf8");
    return {
      sourceRegisterId: sourceIdSchema.parse(summary.sourceRegisterId),
      sourceEventId: summary.sourceEventId,
      medium,
      ledgerArtifact,
      ledgerArtifactFingerprint: digest(ledgerText),
      ledgerFingerprint: summary.ledgerFingerprint,
      boundaryUnits: summary.boundaryUnits,
      eligibleUnits: summary.eligibleUnits,
      excludedUnits: summary.boundaryUnits - summary.eligibleUnits,
      excludedRanges: summary.excludedRanges,
      agreedHighRiskUnits: summary.agreedHighRiskUnits,
      uncertainHighRiskUnits: summary.uncertainHighRiskUnits,
    };
  }));
  const totals = ledgers.reduce((sum, entry) => ({
    sources: 10 as const,
    boundaryUnits: sum.boundaryUnits + entry.boundaryUnits,
    eligibleUnits: sum.eligibleUnits + entry.eligibleUnits,
    excludedUnits: sum.excludedUnits + entry.excludedUnits,
    excludedRanges: sum.excludedRanges + entry.excludedRanges,
    agreedHighRiskUnits: sum.agreedHighRiskUnits + entry.agreedHighRiskUnits,
    uncertainHighRiskUnits: sum.uncertainHighRiskUnits + entry.uncertainHighRiskUnits,
  }), {
    sources: 10 as const, boundaryUnits: 0, eligibleUnits: 0, excludedUnits: 0,
    excludedRanges: 0, agreedHighRiskUnits: 0, uncertainHighRiskUnits: 0,
  });
  return preallocationCapacityManifestSchema.parse({
    schemaVersion: "jolene.personality-preallocation-capacity-manifest.v1",
    status: "all-coding-ready-sources-independently-reviewed-before-allocation",
    frozenAt,
    sourceRegisterFingerprint: register.registerFingerprint,
    boundaryProtocolFingerprint: protocol.protocolFingerprint,
    highRiskTaxonomyFingerprint: protocol.highRiskTaxonomyFingerprint,
    pdfReviewEvidenceFingerprint: pdf.evidenceFingerprint,
    htmlReviewEvidenceFingerprint: html.evidenceFingerprint,
    ledgers,
    totals,
    sourceContentStored: false,
    frozenBeforeAllocation: true,
    selectionPerformed: false,
    observationCodingPerformed: false,
    traitAdmission: "prohibited",
    runtimeActivation: "prohibited",
  });
}

export async function loadPersonalityPreallocationCapacityManifestV1(
  projectRoot = process.cwd(),
) {
  const manifestText = await readFile(path.resolve(
    projectRoot, "research/preallocation-capacity-manifest-v1.yaml",
  ), "utf8");
  const manifest = preallocationCapacityManifestSchema.parse(parse(manifestText));
  const expected = await buildPersonalityPreallocationCapacityManifestV1(
    manifest.frozenAt, projectRoot,
  );
  if (JSON.stringify(manifest) !== JSON.stringify(expected)) {
    throw new Error("Preallocation capacity manifest is stale");
  }
  return { ...manifest, manifestFingerprint: digest(manifestText) };
}

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
