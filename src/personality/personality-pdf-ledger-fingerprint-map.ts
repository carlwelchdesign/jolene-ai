import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { loadPersonalityPdfBoundaryManifestsV1 } from
  "./personality-pdf-boundary-manifests.js";

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const sourceIdSchema = z.enum(["S04", "S08", "S09", "S18"]);
const fingerprintMapSchema = z.object({
  schema_version: z.literal("personality-pdf-ledger-fingerprint-map-v1"),
  generated_at: z.string().datetime(), source_register_id: sourceIdSchema,
  boundary_manifest_fingerprint: sha256Schema,
  boundary_fingerprint_method: z.literal("normalized-joined-text-sha256-v1"),
  ledger_fingerprint_method: z.literal(
    "normalized-length-prefixed-ordered-segments-sha256-v1",
  ),
  source_content_stored: z.literal(false), selection_performed: z.literal(false),
  runtime_activation: z.literal("prohibited"),
  units: z.array(z.object({
    locator: z.string().min(1), boundary_unit_fingerprint: sha256Schema,
    ledger_segment_fingerprint: sha256Schema,
  }).strict()).min(1),
}).strict();
const boundaryManifestSchema = z.object({
  generated_at: z.string().datetime(), source_register_id: sourceIdSchema,
  units: z.array(z.object({
    locator: z.string().min(1), unit_fingerprint: sha256Schema,
  }).passthrough()).min(1),
}).passthrough();

export async function loadPersonalityPdfLedgerFingerprintMapsV1(
  projectRoot = process.cwd(),
) {
  const boundarySnapshot = await loadPersonalityPdfBoundaryManifestsV1(projectRoot);
  const researchRoot = path.resolve(projectRoot, "research");
  const maps = [];
  for (const sourceId of sourceIdSchema.options) {
    const mapText = await readFile(path.resolve(
      researchRoot, "pdf-ledger-fingerprint-maps-v1", `source-${sourceId}.json`,
    ), "utf8");
    const manifestText = await readFile(path.resolve(
      researchRoot, "pdf-boundary-manifests-v1", `source-${sourceId}.json`,
    ), "utf8");
    const unknown: unknown = JSON.parse(mapText);
    assertNoSourceContentFields(unknown);
    const fingerprintMap = fingerprintMapSchema.parse(unknown);
    const manifest = boundaryManifestSchema.parse(JSON.parse(manifestText));
    const boundarySummary = boundarySnapshot.manifests.find(
      (item) => item.sourceRegisterId === sourceId,
    );
    if (fingerprintMap.source_register_id !== sourceId ||
        manifest.source_register_id !== sourceId || !boundarySummary ||
        fingerprintMap.boundary_manifest_fingerprint !== digest(manifestText) ||
        fingerprintMap.boundary_manifest_fingerprint !==
          boundarySummary.manifestFingerprint ||
        Date.parse(fingerprintMap.generated_at) < Date.parse(manifest.generated_at)) {
      throw new Error(`${sourceId} PDF ledger fingerprint map provenance drifted`);
    }
    if (fingerprintMap.units.length !== manifest.units.length ||
        new Set(fingerprintMap.units.map((item) => item.locator)).size !==
          fingerprintMap.units.length || fingerprintMap.units.some((item, index) =>
          item.locator !== manifest.units[index]?.locator ||
          item.boundary_unit_fingerprint !== manifest.units[index]?.unit_fingerprint ||
          item.ledger_segment_fingerprint === item.boundary_unit_fingerprint
        )) {
      throw new Error(`${sourceId} PDF ledger fingerprint conversion is incomplete or stale`);
    }
    maps.push({
      sourceRegisterId: sourceId, units: fingerprintMap.units.length,
      boundaryManifestFingerprint: fingerprintMap.boundary_manifest_fingerprint,
      mapFingerprint: digest(mapText), sourceContentStored: false,
      selectionPerformed: false, runtimeActivation: "prohibited" as const,
    });
  }
  return {
    schemaVersion: "jolene.personality-pdf-ledger-fingerprint-maps.v1" as const,
    maps,
  };
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
      if (forbidden.has(key)) throw new Error("PDF ledger fingerprint map stores source content");
      visit(child);
    }
  };
  visit(input);
}

function digest(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
