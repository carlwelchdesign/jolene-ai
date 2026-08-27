import { readFile } from "node:fs/promises";
import path from "node:path";

import { parse } from "yaml";
import { z } from "zod";

import { loadPersonalitySamplingBoundaryProtocolV1 } from
  "./personality-sampling-boundary-protocol.js";
import { loadPersonalitySourceRegisterV2 } from "./personality-source-register.js";

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const sourceOutcomeSchema = z.object({
  source_register_id: z.enum(["S16", "S17"]),
  source_event_id: z.enum(["E012", "E013"]),
  expected_units: z.union([z.literal(20), z.literal(210)]),
  reviewed_units: z.literal(0),
  map_files_created: z.literal(0),
  failure_code: z.literal("bound-reviewable-media-unavailable"),
}).strict().superRefine((source, context) => {
  const expected = source.source_register_id === "S16"
    ? { event: "E012", units: 20 }
    : { event: "E013", units: 210 };
  if (source.source_event_id !== expected.event || source.expected_units !== expected.units) {
    context.addIssue({ code: "custom", message: "AV recovery source facts disagree" });
  }
});

const outcomeSchema = z.object({
  schema_version: z.literal("personality-av-attribution-recovery-outcome-v1"),
  status: z.literal("failed-before-map-creation"),
  evaluated_at: z.string().datetime(),
  boundary_protocol_fingerprint: sha256Schema,
  source_register_fingerprint: sha256Schema,
  sources: z.array(sourceOutcomeSchema).length(2),
  source_content_stored: z.literal(false),
  selection_performed: z.literal(false),
  observations_created: z.literal(0),
  replacement_performed: z.literal(false),
  required_next_action: z.literal(
    "prospective-source-register-downgrade-and-replacement-research",
  ),
  runtime_activation: z.literal("prohibited"),
}).strict();

export async function loadPersonalityAvRecoveryOutcomeV1(projectRoot = process.cwd()) {
  const text = await readFile(path.resolve(
    projectRoot, "research", "av-attribution-recovery-outcome-v1.yaml",
  ), "utf8");
  const outcome = outcomeSchema.parse(parse(text));
  const [protocol, register] = await Promise.all([
    loadPersonalitySamplingBoundaryProtocolV1(projectRoot),
    loadPersonalitySourceRegisterV2(projectRoot),
  ]);
  if (outcome.boundary_protocol_fingerprint !== protocol.protocolFingerprint ||
      outcome.source_register_fingerprint !== register.registerFingerprint) {
    throw new Error("AV recovery outcome prerequisites are stale");
  }
  if (Date.parse(outcome.evaluated_at) < Math.max(
    Date.parse(register.reviewedAt), Date.parse(protocol.createdAt),
  )) {
    throw new Error("AV recovery outcome predates its prerequisites");
  }
  const ids = outcome.sources.map((source) => source.source_register_id);
  if (new Set(ids).size !== 2 || !ids.includes("S16") || !ids.includes("S17")) {
    throw new Error("AV recovery outcome must cover S16 and S17 exactly");
  }
  return {
    schemaVersion: "jolene.personality-av-attribution-recovery-outcome.v1" as const,
    status: outcome.status,
    boundaryProtocolFingerprint: outcome.boundary_protocol_fingerprint,
    sourceRegisterFingerprint: outcome.source_register_fingerprint,
    failedSources: outcome.sources.map((source) => source.source_register_id),
    expectedUnits: outcome.sources.reduce((sum, source) => sum + source.expected_units, 0),
    reviewedUnits: 0 as const,
    mapFilesCreated: 0 as const,
    sourceContentStored: outcome.source_content_stored,
    selectionPerformed: outcome.selection_performed,
    observationsCreated: outcome.observations_created,
    replacementPerformed: outcome.replacement_performed,
    runtimeActivation: outcome.runtime_activation,
  };
}
