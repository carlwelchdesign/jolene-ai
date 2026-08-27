import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { parse } from "yaml";
import { z } from "zod";

import { loadPersonalitySamplingCapacityAuditV1 } from
  "./personality-sampling-capacity-audit.js";
import { loadPersonalitySourceRegisterV2 } from "./personality-source-register.js";

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const capacityPairSchema = z.object({
  boundary_units: z.number().int().positive(),
  eligible_units: z.number().int().positive(),
}).strict().refine((value) => value.eligible_units <= value.boundary_units,
  "Eligible PDF units exceed boundary");

const protocolSchema = z.object({
  schema_version: z.literal("personality-sampling-boundary-protocol-v1"),
  status: z.literal("precommitted-non-activating"),
  created_at: z.string().datetime(),
  source_register_fingerprint: sha256Schema,
  capacity_audit_fingerprint: sha256Schema,
  source_content_stored: z.literal(false),
  selection_performed: z.literal(false),
  runtime_activation: z.literal("prohibited"),
  execution_order: z.tuple([
    z.literal("verify-source-and-tool-fingerprints"),
    z.literal("build-complete-boundary-capacity-ledgers"),
    z.literal("independently-reproduce-boundaries-and-tags"),
    z.literal("freeze-capacity-ledger-manifest"),
    z.literal("repair-source-register"),
    z.literal("freeze-new-prospective-sampling-plan"),
    z.literal("select-immutable-sample"),
  ]),
  pdf_protocol: z.object({
    id: z.literal("pdf-boundary-protocol-v2"),
    runtime: z.object({
      python: z.literal("3.12.13"),
      pdfplumber: z.literal("0.11.9"),
      pdfminer_six: z.literal("20251230"),
      pypdf: z.literal("6.10.0"),
      version_drift: z.literal("fail-closed"),
      ocr_fallback: z.literal("prohibited"),
    }).strict(),
    labeled_pdf_extraction: z.object({
      sources: z.tuple([z.literal("S04"), z.literal("S08"), z.literal("S09")]),
      method: z.literal("pdfplumber-extract-text-lines"),
      x_tolerance: z.literal(3), y_tolerance: z.literal(3),
      layout: z.literal(false), strip: z.literal(true), return_chars: z.literal(false),
      ordering: z.literal("page-top-x0-original-index"),
      normalization: z.literal("nfc-trim-discard-empty"),
    }).strict(),
    furniture: z.object({
      repeated_margin_band_fraction: z.literal(0.10),
      repeated_exact_line_minimum_pages: z.literal(3),
      page_number_regex: z.string().min(1), labels_exempt: z.literal(true),
      source_control_regex: z.object({
        S04: z.string().min(1), S08: z.string().min(1), S09: z.null(),
      }).strict(),
    }).strict(),
    label_regex: z.object({
      S04: z.string().min(1), S08: z.string().min(1), S09: z.string().min(1),
    }).strict(),
    cue_handling: z.object({
      performance: z.array(z.string()).min(1), nonverbal: z.array(z.string()).min(1),
      unreadable: z.array(z.string()).min(1),
      performance_result: z.literal("exclude-whole-block-lyric-or-performance"),
      embedded_nonverbal_result: z.literal("remove-cue-retain-spoken-payload"),
      cue_only_result: z.literal("controlled-exclusion"),
    }).strict(),
    fragment_rule: z.object({
      token_regex: z.string().min(1), maximum_tokens: z.literal(4),
      closed_token_set: z.array(z.string()).min(1),
      result: z.literal("exclude-too-fragmentary-only-when-all-tokens-in-closed-set"),
    }).strict(),
    attributed_statement_extraction: z.object({
      sources: z.tuple([z.literal("S18")]), method: z.literal("pypdf-layout"),
      extraction_mode: z.literal("layout"), layout_mode_space_vertically: z.literal(true),
      layout_mode_scale_weight: z.literal(1.25), layout_mode_strip_rotated: z.literal(true),
      layout_mode_font_height_weight: z.literal(1), paragraph_split_regex: z.string().min(1),
      cross_page_merge_unless_prior_ends_regex: z.string().min(1),
      named_attribution_regex: z.string().min(1), continuation_regex: z.string().min(1),
      continuation_scope: z.literal("immediately-following-before-intervening-speaker"),
    }).strict(),
    reproduced_capacity: z.object({
      S04: capacityPairSchema, S08: capacityPairSchema,
      S09: capacityPairSchema, S18: capacityPairSchema,
    }).strict(),
  }).strict(),
  av_protocols: z.object({
    S16: z.object({
      id: z.literal("blank-on-blank-av-aligned-paragraphs-v1"),
      status: z.literal("map-required-before-coding-ready"), stable_text_units: z.literal(20),
      media_identities: z.object({
        soundcloud_track_id: z.literal("259287975"),
        youtube_video_id: z.literal("2RJPc9DXnys"),
        youtube_channel_id: z.literal("UC9pO2YNforRbdwKOh09djKA"),
        duration_seconds: z.literal(326),
        transient_media_fingerprint: z.literal("required"),
      }).strict(),
      complete_map: z.literal("required"), independent_full_media_reviews: z.literal(2),
      unresolved_result: z.literal("excluded"),
    }).strict(),
    S17: z.object({
      id: z.literal("wired-av-verified-caption-speaker-blocks-v1"),
      status: z.literal("map-required-before-coding-ready"), stable_caption_units: z.literal(210),
      wired_content_id: z.literal("5f762fadbcdfff7e12c683f1"),
      duration_milliseconds: z.literal(523000), timing_vector_fingerprint: z.literal("required"),
      last_caption_end_milliseconds: z.literal(523150),
      complete_map: z.literal("required"), independent_full_media_reviews: z.literal(2),
      unresolved_result: z.literal("excluded"),
    }).strict(),
  }).strict(),
  unrecoverable_sources: z.object({
    S07: z.object({
      result: z.literal("downgrade"),
      reason: z.literal("explicit-speaker-attribution-unavailable"),
    }).strict(),
  }).strict(),
  high_risk_adjudication: z.object({
    id: z.literal("two-independent-reviewer-consensus-v1"),
    taxonomy_fingerprint: sha256Schema,
    taxonomy: z.object({
      belief: z.literal("explicit religion spirituality or moral-conviction discussion"),
      biography: z.literal("personal history family health relationship or career-history account"),
      boundary: z.literal("explicit refusal limit condition correction or protected line"),
      contradiction: z.literal("explicit tension change counterevidence or competing claim"),
      "grief-or-hurt": z.literal("loss injury shame failure grief or described emotional pain"),
      humor: z.literal("observable joke wordplay self-deprecation comic reversal or laughter cue"),
      "identity-trait": z.literal("explicit self-description as a type of person or stable attribute"),
      politics: z.literal("policy elected office civic controversy or partisan positioning"),
      "voice-adjacent": z.literal("accent singing vocal sound or voice-performance discussion"),
      "workplace-sexual-boundary": z.literal("workplace conduct harassment sexualized treatment or appearance boundary"),
    }).strict(),
    reviewers_per_unit: z.literal(2), blind_to_trait_outcomes: z.literal(true),
    blind_to_fame_and_quotability: z.literal(true),
    disagreement_result: z.literal("no-high-risk-tag"),
    systematic_eligibility_unchanged_by_tag_disagreement: z.literal(true),
    capacity_measure: z.literal("agreed-tagged-units-remaining-after-proposed-systematic-midpoints"),
    preallocation_manifest_required: z.literal(true),
    future_capacity_manifest_taxonomy_fingerprint_required: z.literal(true),
    future_sampling_plan_taxonomy_fingerprint_required: z.literal(true),
  }).strict(),
  rights: z.object({
    repository_storage: z.literal("metadata-hashes-locators-and-controlled-labels-only"),
    excerpts: z.literal("prohibited"), transcripts: z.literal("prohibited"),
    lyrics: z.literal("prohibited"), audio_video: z.literal("prohibited"),
    recognizable_expression: z.literal("prohibited"),
  }).strict(),
  next_action: z.literal("complete-av-maps-and-source-register-v3"),
}).strict();

export async function loadPersonalitySamplingBoundaryProtocolV1(projectRoot = process.cwd()) {
  const protocolText = await readFile(path.resolve(
    projectRoot, "research", "sampling-boundary-protocol-v1.yaml",
  ), "utf8");
  const protocol = protocolSchema.parse(parse(protocolText));
  const [register, capacityAudit] = await Promise.all([
    loadPersonalitySourceRegisterV2(projectRoot),
    loadPersonalitySamplingCapacityAuditV1(projectRoot),
  ]);
  if (protocol.source_register_fingerprint !== register.registerFingerprint ||
      protocol.capacity_audit_fingerprint !== capacityAudit.auditFingerprint) {
    throw new Error("Sampling boundary protocol prerequisites are stale");
  }
  if (Date.parse(protocol.created_at) < Math.max(
    Date.parse(register.reviewedAt), Date.parse(capacityAudit.auditedAt),
  )) {
    throw new Error("Sampling boundary protocol predates its prerequisites");
  }
  const taxonomyFingerprint = digest(JSON.stringify(protocol.high_risk_adjudication.taxonomy));
  if (protocol.high_risk_adjudication.taxonomy_fingerprint !== taxonomyFingerprint) {
    throw new Error("High-risk taxonomy fingerprint is invalid");
  }
  return {
    schemaVersion: "jolene.personality-sampling-boundary-protocol.v1" as const,
    protocolFingerprint: digest(protocolText),
    status: protocol.status,
    pdfProtocolId: protocol.pdf_protocol.id,
    reproducedPdfCapacity: protocol.pdf_protocol.reproduced_capacity,
    audiovisualMapSources: Object.keys(protocol.av_protocols),
    downgradedSources: Object.keys(protocol.unrecoverable_sources),
    highRiskProtocolId: protocol.high_risk_adjudication.id,
    highRiskTaxonomyFingerprint: taxonomyFingerprint,
    selectionPerformed: protocol.selection_performed,
    sourceContentStored: protocol.source_content_stored,
    runtimeActivation: protocol.runtime_activation,
  };
}

function digest(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
