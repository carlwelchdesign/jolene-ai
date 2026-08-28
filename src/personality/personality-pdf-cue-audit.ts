import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { parse } from "yaml";
import { z } from "zod";

import { loadPersonalitySamplingBoundaryProtocolV1 } from
  "./personality-sampling-boundary-protocol.js";
import { loadPersonalitySourceRegisterV3 } from "./personality-source-register-v3.js";

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const policyResultSchema = z.object({
  excluded_target_blocks: z.number().int().nonnegative(),
  eligible_units: z.number().int().nonnegative(),
}).strict();

const auditSchema = z.object({
  schema_version: z.literal("personality-pdf-cue-adjudication-audit-v1"),
  status: z.literal("protocol-repair-required-before-pdf-drafts"),
  audited_at: z.string().datetime(), source_register_fingerprint: sha256Schema,
  boundary_protocol_fingerprint: sha256Schema, source_register_id: z.literal("S04"),
  source_event_id: z.literal("E004"), source_content_fingerprint: sha256Schema,
  runtime: z.object({
    python: z.literal("3.12.13"), pdfplumber: z.literal("0.11.9"),
    pdfminer_six: z.literal("20251230"), pypdf: z.literal("6.10.0"),
    version_drift: z.literal("fail-closed"),
  }).strict(),
  boundary_reproduction: z.object({
    source_boundary_units: z.literal(101), prelabel_excluded_units: z.literal(1),
    labeled_speaker_blocks: z.literal(100), target_speaker_blocks: z.literal(49),
    other_speaker_blocks: z.literal(51),
  }).strict(),
  controlled_cue_audit: z.object({
    target_blocks_with_any_controlled_cue: z.literal(23),
    target_block_category_counts: z.object({
      performance: z.literal(4), nonverbal: z.literal(19), unreadable: z.literal(5),
    }).strict(),
    target_cue_occurrences: z.object({
      PERFORMANCE: z.literal(1), SINGING: z.literal(4), LAUGHTER: z.literal(13),
      APPLAUSE: z.literal(10), INAUDIBLE: z.literal(5),
    }).strict(),
  }).strict(),
  literal_policy_comparison: z.object({
    frozen_expected_eligible_units: z.literal(48),
    exclude_any_performance_or_unreadable_block: policyResultSchema,
    exclude_any_performance_block_only: policyResultSchema,
    exclude_any_unreadable_block_only: policyResultSchema,
    strip_embedded_controlled_cues_and_retain_nonempty_payload: policyResultSchema,
    tested_literal_policy_matches_frozen_capacity: z.literal(false),
  }).strict(),
  conclusion: z.string().min(1), source_content_stored: z.literal(false),
  selection_performed: z.literal(false), runtime_activation: z.literal("prohibited"),
  next_action: z.literal(
    "freeze-prospective-cue-adjudication-amendment-after-two-independent-full-boundary-reviews",
  ),
}).strict();

export async function loadPersonalityPdfCueAdjudicationAuditV1(projectRoot = process.cwd()) {
  const auditText = await readFile(path.resolve(
    projectRoot, "research", "pdf-cue-adjudication-audit-v1.yaml",
  ), "utf8");
  const audit = auditSchema.parse(parse(auditText));
  const [register, protocol] = await Promise.all([
    loadPersonalitySourceRegisterV3(projectRoot),
    loadPersonalitySamplingBoundaryProtocolV1(projectRoot),
  ]);
  const source = register.events.find(
    (candidate) => candidate.sourceRegisterId === audit.source_register_id,
  );
  if (audit.source_register_fingerprint !== register.registerFingerprint ||
      audit.boundary_protocol_fingerprint !== protocol.protocolFingerprint) {
    throw new Error("PDF cue audit prerequisites are stale");
  }
  if (!source || source.sourceEventId !== audit.source_event_id ||
      source.sourceContentFingerprint !== audit.source_content_fingerprint) {
    throw new Error("PDF cue audit source provenance is stale");
  }
  const boundary = audit.boundary_reproduction;
  if (boundary.prelabel_excluded_units + boundary.labeled_speaker_blocks !==
      boundary.source_boundary_units ||
      boundary.target_speaker_blocks + boundary.other_speaker_blocks !==
      boundary.labeled_speaker_blocks) {
    throw new Error("PDF cue audit boundary arithmetic is invalid");
  }
  const comparison = audit.literal_policy_comparison;
  const expectedPolicies = [
    [comparison.exclude_any_performance_or_unreadable_block, 9],
    [comparison.exclude_any_performance_block_only, 4],
    [comparison.exclude_any_unreadable_block_only, 5],
    [comparison.strip_embedded_controlled_cues_and_retain_nonempty_payload, 0],
  ] as const;
  for (const [result, excluded] of expectedPolicies) {
    if (result.excluded_target_blocks !== excluded ||
        result.eligible_units !== boundary.target_speaker_blocks - excluded) {
      throw new Error("PDF cue audit policy arithmetic is invalid");
    }
  }
  if (expectedPolicies.some(([result]) =>
    result.eligible_units === comparison.frozen_expected_eligible_units)) {
    throw new Error("PDF cue audit no longer demonstrates protocol underdetermination");
  }
  return {
    schemaVersion: "jolene.personality-pdf-cue-adjudication-audit.v1" as const,
    status: audit.status, auditedAt: audit.audited_at,
    sourceRegisterId: audit.source_register_id,
    sourceBoundaryUnits: boundary.source_boundary_units,
    targetSpeakerBlocks: boundary.target_speaker_blocks,
    frozenExpectedEligibleUnits: comparison.frozen_expected_eligible_units,
    literalEligibleOutcomes: expectedPolicies.map(([result]) => result.eligible_units),
    testedLiteralPolicyMatchesFrozenCapacity:
      comparison.tested_literal_policy_matches_frozen_capacity,
    sourceContentStored: audit.source_content_stored,
    selectionPerformed: audit.selection_performed,
    runtimeActivation: audit.runtime_activation, nextAction: audit.next_action,
    auditFingerprint: digest(auditText),
  };
}

function digest(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
