import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { parse } from "yaml";
import { z } from "zod";

import { loadPersonalityPdfCueAdjudicationAuditV1 } from
  "./personality-pdf-cue-audit.js";
import { loadPersonalitySamplingBoundaryProtocolV1 } from
  "./personality-sampling-boundary-protocol.js";
import { loadPersonalitySourceRegisterV3 } from
  "./personality-source-register-v3.js";

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const runtimeSchema = z.object({
  python: z.literal("3.12.13"),
  pdfplumber: z.literal("0.11.9"),
  pdfminer_six: z.literal("20251230"),
  pypdf: z.literal("6.10.0"),
}).strict();
const dispositionPrecedenceSchema = z.tuple([
  z.literal("other-or-prelabel-exclusion"),
  z.literal("performance-cue-whole-block-exclusion"),
  z.literal("nonverbal-unreadable-cue-stripping"),
  z.literal("empty-residual-exclusion"),
  z.literal("closed-set-fragment-exclusion"),
  z.literal("eligible-spoken-payload"),
]);
const countSchema = z.object({
  boundary_units: z.literal(101), prelabel_units: z.literal(1),
  labeled_speaker_blocks: z.literal(100), target_speaker_blocks: z.literal(49),
  other_speaker_blocks: z.literal(51),
  performance_excluded_target_blocks: z.literal(4),
  eligible_target_blocks: z.literal(45),
}).strict();
const unitSchema = z.object({
  ordinal: z.number().int().min(1).max(101),
  locator: z.string().regex(/^pdf-(?:prelabel-1|page-\d+-speaker-block-\d+)$/u),
  unit_fingerprint: sha256Schema,
  speaker_class: z.enum(["prelabel", "target", "other"]),
  cue_categories: z.array(z.enum(["performance", "nonverbal", "unreadable"]))
    .max(3),
  cue_occurrences: z.partialRecord(
    z.enum(["PERFORMANCE", "SINGING", "LAUGHTER", "APPLAUSE", "INAUDIBLE"]),
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
  schema_version: z.literal("personality-s04-boundary-manifest-v1"),
  generated_at: z.string().datetime(),
  source_register_id: z.literal("S04"), source_event_id: z.literal("E004"),
  source_url: z.literal("https://www.press.org/sites/default/files/20090210_parton.pdf"),
  source_content_fingerprint: sha256Schema, runtime: runtimeSchema,
  rule_id: z.literal("pdf-cue-adjudication-conservative-v1"),
  disposition_precedence: dispositionPrecedenceSchema,
  counts: countSchema, source_content_stored: z.literal(false),
  selection_performed: z.literal(false), runtime_activation: z.literal("prohibited"),
  units: z.array(unitSchema).length(101),
}).strict();
const reviewSchema = z.object({
  reviewer_id: z.enum([
    "independent-data-methodology-reviewer",
    "independent-trust-rights-reviewer",
  ]),
  role: z.enum(["data-methodology", "trust-rights"]),
  reviewed_at: z.string().datetime(),
  scope: z.literal("independent-full-boundary-live-reproduction"),
  verdict: z.literal("pass"), eligible_target_blocks: z.literal(45),
  attestation_fingerprint: sha256Schema,
}).strict();
const amendmentSchema = z.object({
  schema_version: z.literal("personality-pdf-cue-adjudication-amendment-v1"),
  status: z.literal("prospective-reviewed-non-activating"),
  created_at: z.string().datetime(), source_register_fingerprint: sha256Schema,
  predecessor_boundary_protocol_fingerprint: sha256Schema,
  predecessor_cue_audit_fingerprint: sha256Schema,
  boundary_manifest_fingerprint: sha256Schema,
  source_register_id: z.literal("S04"), source_event_id: z.literal("E004"),
  source_content_fingerprint: sha256Schema,
  runtime: runtimeSchema.extend({ version_drift: z.literal("fail-closed") }).strict(),
  rule: z.object({
    id: z.literal("pdf-cue-adjudication-conservative-v1"),
    atomic_unit: z.literal("complete-labeled-speaker-block"),
    disposition_precedence: dispositionPrecedenceSchema,
    performance_cue_result: z.literal("exclude-whole-atomic-block"),
    performance_exclusion_is_irreversible: z.literal(true),
    nonverbal_unreadable_result: z.literal("strip-structurally-delimited-cue-only"),
    cue_only_result: z.literal("exclude"),
    fragment_rule: z.literal("inherit-pdf-boundary-protocol-v2"),
  }).strict(),
  reproduced_counts: countSchema.extend({
    target_blocks_with_any_controlled_cue: z.literal(23),
    cue_occurrences: z.object({
      PERFORMANCE: z.literal(1), SINGING: z.literal(4),
      LAUGHTER: z.literal(13), APPLAUSE: z.literal(10),
      INAUDIBLE: z.literal(5),
    }).strict(),
  }).strict(),
  supersession: z.object({
    frozen_expected_eligible_units: z.literal(48),
    result: z.literal("superseded-for-future-plans-only"),
    reason: z.string().min(1),
  }).strict(),
  independent_reviews: z.array(reviewSchema).length(2),
  rights: z.object({
    repository_storage: z.literal("metadata-hashes-locators-and-controlled-labels-only"),
    source_content: z.literal("prohibited"), excerpts: z.literal("prohibited"),
    transcripts: z.literal("prohibited"), lyrics: z.literal("prohibited"),
    performance_material: z.literal("prohibited"),
    audio_video: z.literal("prohibited"),
    recognizable_expression: z.literal("prohibited"),
  }).strict(),
  source_content_stored: z.literal(false), selection_performed: z.literal(false),
  observation_coding_performed: z.literal(false),
  runtime_activation: z.literal("prohibited"),
  next_action: z.literal("generate-reviewed-pdf-capacity-ledgers-under-amended-rule"),
}).strict();

export async function loadPersonalityPdfCueAdjudicationAmendmentV1(
  projectRoot = process.cwd(),
) {
  const researchRoot = path.resolve(projectRoot, "research");
  const amendmentText = await readFile(
    path.resolve(researchRoot, "pdf-cue-adjudication-amendment-v1.yaml"), "utf8",
  );
  const manifestText = await readFile(
    path.resolve(researchRoot, "pdf-boundary-manifests-v1", "source-S04.json"),
    "utf8",
  );
  const amendment = amendmentSchema.parse(parse(amendmentText));
  const manifestUnknown: unknown = JSON.parse(manifestText);
  assertNoSourceContentFields(manifestUnknown);
  const manifest = manifestSchema.parse(manifestUnknown);
  const [register, protocol, audit] = await Promise.all([
    loadPersonalitySourceRegisterV3(projectRoot),
    loadPersonalitySamplingBoundaryProtocolV1(projectRoot),
    loadPersonalityPdfCueAdjudicationAuditV1(projectRoot),
  ]);
  if (amendment.source_register_fingerprint !== register.registerFingerprint ||
      amendment.predecessor_boundary_protocol_fingerprint !== protocol.protocolFingerprint ||
      amendment.predecessor_cue_audit_fingerprint !== audit.auditFingerprint ||
      amendment.boundary_manifest_fingerprint !== digest(manifestText)) {
    throw new Error("PDF cue amendment prerequisites are stale");
  }
  const sourceEvent = register.events.find((item) => item.sourceRegisterId === "S04");
  if (amendment.source_content_fingerprint !== manifest.source_content_fingerprint ||
      amendment.source_content_fingerprint !== sourceEvent?.sourceContentFingerprint ||
      runtimeKeys.some((key) =>
        amendment.runtime[key] !== manifest.runtime[key]
      )) {
    throw new Error("PDF cue amendment source provenance is stale");
  }
  if (Date.parse(amendment.created_at) <= Date.parse(audit.auditedAt) ||
      Date.parse(amendment.created_at) < Date.parse(manifest.generated_at)) {
    throw new Error("PDF cue amendment predates its prerequisites");
  }
  validateUnits(amendment, manifest);
  validateReviews(amendment, manifest);
  return {
    schemaVersion: "jolene.personality-pdf-cue-adjudication-amendment.v1" as const,
    status: amendment.status, createdAt: amendment.created_at,
    ruleId: amendment.rule.id, sourceRegisterId: amendment.source_register_id,
    boundaryUnits: manifest.counts.boundary_units,
    targetSpeakerBlocks: manifest.counts.target_speaker_blocks,
    performanceExcludedTargetBlocks:
      manifest.counts.performance_excluded_target_blocks,
    eligibleTargetBlocks: manifest.counts.eligible_target_blocks,
    reviewerCount: amendment.independent_reviews.length,
    sourceContentStored: amendment.source_content_stored,
    selectionPerformed: amendment.selection_performed,
    runtimeActivation: amendment.runtime_activation,
    amendmentFingerprint: digest(amendmentText),
    manifestFingerprint: digest(manifestText),
  };
}

const runtimeKeys = ["python", "pdfplumber", "pdfminer_six", "pypdf"] as const;

function validateUnits(
  amendment: z.infer<typeof amendmentSchema>,
  manifest: z.infer<typeof manifestSchema>,
): void {
  if (new Set(manifest.units.map((item) => item.ordinal)).size !== 101 ||
      new Set(manifest.units.map((item) => item.locator)).size !== 101) {
    throw new Error("PDF boundary manifest units are not unique");
  }
  const target = manifest.units.filter((item) => item.speaker_class === "target");
  const prelabel = manifest.units.filter((item) => item.speaker_class === "prelabel");
  const other = manifest.units.filter((item) => item.speaker_class === "other");
  const cueBearing = target.filter((item) => item.cue_categories.length > 0);
  const performance = target.filter((item) => item.cue_categories.includes("performance"));
  const eligible = target.filter((item) => item.disposition === "eligible");
  const cueOccurrences = target.reduce<Record<string, number>>((counts, item) => {
    for (const [cue, count] of Object.entries(item.cue_occurrences)) {
      counts[cue] = (counts[cue] ?? 0) + count;
    }
    return counts;
  }, {});
  if (prelabel.length !== 1 || target.length !== 49 || other.length !== 51 ||
      cueBearing.length !== 23 || performance.length !== 4 || eligible.length !== 45 ||
      amendment.reproduced_counts.boundary_units !== manifest.counts.boundary_units ||
      amendment.reproduced_counts.prelabel_units !== prelabel.length ||
      amendment.reproduced_counts.labeled_speaker_blocks !== target.length + other.length ||
      amendment.reproduced_counts.target_speaker_blocks !== target.length ||
      amendment.reproduced_counts.other_speaker_blocks !== other.length ||
      amendment.reproduced_counts.target_blocks_with_any_controlled_cue !== cueBearing.length ||
      amendment.reproduced_counts.performance_excluded_target_blocks !== performance.length ||
      amendment.reproduced_counts.eligible_target_blocks !== eligible.length ||
      Object.entries(amendment.reproduced_counts.cue_occurrences)
        .some(([cue, count]) => cueOccurrences[cue] !== count) ||
      performance.some((item) => item.reason !== "performance-cue-whole-block" ||
        item.disposition !== "excluded" || item.residual_token_count !== null) ||
      target.filter((item) => !item.cue_categories.includes("performance"))
        .some((item) => item.disposition !== "eligible" ||
          item.reason !== "spoken-payload" || item.fragment_result !== "passed" ||
          item.residual_token_count === null || item.residual_token_count < 1) ||
      manifest.units.filter((item) => item.speaker_class !== "target")
        .some((item) => item.disposition !== "excluded")) {
    throw new Error("PDF boundary manifest violates conservative disposition precedence");
  }
}

function validateReviews(
  amendment: z.infer<typeof amendmentSchema>,
  manifest: z.infer<typeof manifestSchema>,
): void {
  const reviewers = amendment.independent_reviews;
  if (new Set(reviewers.map((item) => item.reviewer_id)).size !== 2 ||
      new Set(reviewers.map((item) => item.role)).size !== 2) {
    throw new Error("PDF cue amendment requires two distinct independent reviewers");
  }
  for (const review of reviewers) {
    if (Date.parse(review.reviewed_at) < Date.parse(manifest.generated_at) ||
        Date.parse(review.reviewed_at) > Date.parse(amendment.created_at)) {
      throw new Error("PDF cue amendment reviewer chronology is invalid");
    }
    const canonical = [
      review.reviewer_id, review.role, amendment.source_content_fingerprint,
      amendment.boundary_manifest_fingerprint, amendment.rule.id,
      review.verdict, String(review.eligible_target_blocks),
    ].join("|");
    if (review.attestation_fingerprint !== digest(canonical)) {
      throw new Error("PDF cue amendment reviewer attestation is invalid");
    }
  }
}

function assertNoSourceContentFields(input: unknown): void {
  const forbidden = new Set([
    "source_text", "text", "content", "excerpt", "quote", "transcript",
    "lyrics", "performance_material", "audio", "video", "recognizable_expression",
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
