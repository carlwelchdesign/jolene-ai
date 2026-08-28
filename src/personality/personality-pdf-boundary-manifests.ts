import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { loadPersonalityPdfCueAdjudicationAmendmentV1 } from
  "./personality-pdf-cue-amendment.js";
import { loadPersonalitySamplingBoundaryProtocolV1 } from
  "./personality-sampling-boundary-protocol.js";
import { loadPersonalitySourceRegisterV3 } from
  "./personality-source-register-v3.js";

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const sourceIdSchema = z.enum(["S04", "S08", "S09", "S18"]);
const runtimeSchema = z.object({
  python: z.literal("3.12.13"), pdfplumber: z.literal("0.11.9"),
  pdfminer_six: z.literal("20251230"), pypdf: z.literal("6.10.0"),
}).strict();
const unitSchema = z.object({
  ordinal: z.number().int().nonnegative(),
  locator: z.string().regex(/^pdf-(?:prelabel-1|page-\d+-(?:speaker-block|paragraph)-\d+)$/u),
  unit_fingerprint: sha256Schema,
  speaker_class: z.enum(["prelabel", "target", "other"]),
  cue_categories: z.array(z.enum(["performance", "nonverbal", "unreadable"]))
    .max(3),
  cue_occurrences: z.partialRecord(
    z.enum(["PERFORMANCE", "SINGING", "MUSIC", "LAUGHTER", "APPLAUSE", "INAUDIBLE"]),
    z.number().int().positive(),
  ),
  disposition: z.enum(["eligible", "excluded"]),
  reason: z.enum([
    "prelabel-non-dialogue", "other-speaker", "performance-cue-whole-block",
    "cue-only-or-empty", "closed-set-fragment", "spoken-payload",
  ]),
  residual_token_count: z.number().int().nonnegative().nullable(),
  fragment_result: z.enum(["not-evaluated", "excluded", "passed"]),
}).strict();
const manifestSchema = z.object({
  schema_version: z.enum([
    "personality-s04-boundary-manifest-v1", "personality-pdf-boundary-manifest-v1",
  ]),
  generated_at: z.string().datetime(), source_register_id: sourceIdSchema,
  source_event_id: z.string().regex(/^E\d{3}$/u), source_url: z.string().url(),
  source_content_fingerprint: sha256Schema, runtime: runtimeSchema,
  rule_id: z.enum([
    "pdf-cue-adjudication-conservative-v1", "pdf-speaker-label-blocks-v2",
    "pdf-attributed-statement-blocks-v2",
  ]),
  disposition_precedence: z.array(z.string()).optional(),
  counts: z.object({
    boundary_units: z.number().int().positive(),
    eligible_units: z.number().int().nonnegative().optional(),
    excluded_units: z.number().int().nonnegative().optional(),
    prelabel_units: z.number().int().nonnegative().optional(),
    labeled_speaker_blocks: z.number().int().nonnegative().optional(),
    target_speaker_blocks: z.number().int().nonnegative().optional(),
    other_speaker_blocks: z.number().int().nonnegative().optional(),
    performance_excluded_target_blocks: z.number().int().nonnegative().optional(),
    eligible_target_blocks: z.number().int().nonnegative().optional(),
  }).strict(),
  source_content_stored: z.literal(false), selection_performed: z.literal(false),
  runtime_activation: z.literal("prohibited"), units: z.array(unitSchema).min(1),
}).strict();

const expected = {
  S04: { event: "E004", boundary: 101, eligible: 45,
    rule: "pdf-cue-adjudication-conservative-v1" },
  S08: { event: "E007", boundary: 199, eligible: 88,
    rule: "pdf-speaker-label-blocks-v2" },
  S09: { event: "E008", boundary: 11, eligible: 5,
    rule: "pdf-speaker-label-blocks-v2" },
  S18: { event: "E014", boundary: 19, eligible: 2,
    rule: "pdf-attributed-statement-blocks-v2" },
} as const;

export async function loadPersonalityPdfBoundaryManifestsV1(
  projectRoot = process.cwd(),
) {
  const researchRoot = path.resolve(projectRoot, "research");
  const [register, protocol, amendment] = await Promise.all([
    loadPersonalitySourceRegisterV3(projectRoot),
    loadPersonalitySamplingBoundaryProtocolV1(projectRoot),
    loadPersonalityPdfCueAdjudicationAmendmentV1(projectRoot),
  ]);
  const results = [];
  for (const sourceId of sourceIdSchema.options) {
    const manifestPath = path.resolve(
      researchRoot, "pdf-boundary-manifests-v1", `source-${sourceId}.json`,
    );
    const text = await readFile(manifestPath, "utf8");
    const unknown: unknown = JSON.parse(text);
    assertNoSourceContentFields(unknown);
    const manifest = manifestSchema.parse(unknown);
    const expectation = expected[sourceId];
    const source = register.events.find((item) => item.sourceRegisterId === sourceId);
    const eligible = manifest.units.filter((item) => item.disposition === "eligible");
    if (manifest.source_register_id !== sourceId ||
        manifest.source_event_id !== expectation.event ||
        manifest.rule_id !== expectation.rule ||
        manifest.counts.boundary_units !== expectation.boundary ||
        manifest.units.length !== expectation.boundary ||
        eligible.length !== expectation.eligible) {
      throw new Error(`${sourceId} PDF boundary manifest counts or rule drifted`);
    }
    if (!source || source.accessState !== "coding-ready" ||
        manifest.source_event_id !== source.sourceEventId ||
        manifest.source_url !== source.contentBoundaryUrl ||
        manifest.source_content_fingerprint !== source.sourceContentFingerprint) {
      throw new Error(`${sourceId} PDF boundary manifest provenance drifted`);
    }
    if (Date.parse(manifest.generated_at) < Date.parse(register.reviewedAt) ||
        Date.parse(manifest.generated_at) < Date.parse(protocol.createdAt) ||
        (sourceId === "S04" && digest(text) !== amendment.manifestFingerprint)) {
      throw new Error(`${sourceId} PDF boundary manifest prerequisite drifted`);
    }
    validateCompleteBoundary(sourceId, manifest);
    results.push({
      sourceRegisterId: sourceId, sourceEventId: manifest.source_event_id,
      boundaryUnits: manifest.units.length, eligibleUnits: eligible.length,
      excludedUnits: manifest.units.length - eligible.length,
      manifestFingerprint: digest(text), sourceContentStored: false,
      selectionPerformed: false, runtimeActivation: "prohibited" as const,
    });
  }
  return {
    schemaVersion: "jolene.personality-pdf-boundary-manifests.v1" as const,
    amendmentFingerprint: amendment.amendmentFingerprint,
    manifests: results,
  };
}

function validateCompleteBoundary(
  sourceId: z.infer<typeof sourceIdSchema>,
  manifest: z.infer<typeof manifestSchema>,
): void {
  const ordinals = manifest.units.map((item) => item.ordinal);
  const expectedOrdinals = sourceId === "S04"
    ? Array.from({ length: manifest.units.length }, (_, index) => index + 1)
    : Array.from({ length: manifest.units.length }, (_, index) => index);
  if (JSON.stringify(ordinals) !== JSON.stringify(expectedOrdinals) ||
      new Set(manifest.units.map((item) => item.locator)).size !== manifest.units.length) {
    throw new Error(`${sourceId} PDF boundary is incomplete, unordered, or duplicated`);
  }
  for (const unit of manifest.units) {
    const targetEligible = unit.speaker_class === "target" &&
      !unit.cue_categories.includes("performance") && unit.reason === "spoken-payload" &&
      unit.residual_token_count !== null && unit.residual_token_count > 0 &&
      unit.fragment_result === "passed";
    const performanceExcluded = unit.speaker_class === "target" &&
      unit.cue_categories.includes("performance") &&
      unit.reason === "performance-cue-whole-block" &&
      unit.residual_token_count === null && unit.fragment_result === "not-evaluated";
    const nonTargetExcluded = unit.speaker_class !== "target" &&
      (unit.reason === "prelabel-non-dialogue" || unit.reason === "other-speaker") &&
      unit.residual_token_count === null && unit.fragment_result === "not-evaluated";
    const fragmentExcluded = unit.speaker_class === "target" &&
      (unit.reason === "cue-only-or-empty" || unit.reason === "closed-set-fragment") &&
      unit.disposition === "excluded";
    if ((unit.disposition === "eligible" && !targetEligible) ||
        (unit.disposition === "excluded" &&
          !performanceExcluded && !nonTargetExcluded && !fragmentExcluded)) {
      throw new Error(`${sourceId} PDF boundary disposition precedence drifted`);
    }
  }
}

function assertNoSourceContentFields(input: unknown): void {
  const forbidden = new Set([
    "source_text", "text", "content", "excerpt", "quote", "transcript", "lyrics",
    "performance_material", "audio", "video", "recognizable_expression",
  ]);
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (forbidden.has(key)) throw new Error("PDF boundary manifest stores prohibited source content");
      visit(child);
    }
  };
  visit(input);
}

function digest(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
