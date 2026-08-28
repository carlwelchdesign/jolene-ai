import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildS03DuplicateOverlapAmendment,
  loadS03DuplicateOverlapAmendment,
} from "../src/personality/personality-s03-duplicate-overlap-amendment.js";
import { preallocationCapacityLedgerSchema } from
  "../src/personality/personality-preallocation-capacity-ledger.js";
import { loadPersonalityPreallocationCapacityManifestV1 } from
  "../src/personality/personality-preallocation-capacity-manifest.js";
import { loadS03DuplicateOverlapAudit } from
  "../src/personality/personality-s03-duplicate-overlap-audit.js";

describe("S03 duplicate-overlap amendment", () => {
  it("loads the dual-reviewed conservative non-activating amendment", async () => {
    await expect(loadS03DuplicateOverlapAmendment()).resolves.toMatchObject({
      status: "independently-reviewed-before-new-plan",
      counts: {
        eligibleOccurrences: 270,
        uniqueFingerprintGroups: 133,
        duplicateOccurrencesBeyondRepresentative: 137,
        uncertaintyWithheldGroups: 63,
      },
      reviews: [
        { reviewRole: "primary", verdict: "pass", discrepancyCount: 0 },
        { reviewRole: "independent", verdict: "pass", discrepancyCount: 0 },
      ],
      sourceContentStored: false,
      selectionPerformed: false,
      observationCodingPerformed: false,
      traitAdmission: "prohibited",
      runtimeActivation: "prohibited",
      amendmentFingerprint: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
    });
  }, 15_000);

  it("rejects a review with stale audit provenance or any discrepancy", async () => {
    const { primary, independent } = await reviewFixtures();
    primary.audit_fingerprint = `sha256:${"0".repeat(64)}`;
    await expect(buildS03DuplicateOverlapAmendment(
      `${JSON.stringify(primary)}\n`, `${JSON.stringify(independent)}\n`,
      "2026-08-28T08:00:00.000Z",
    )).rejects.toThrow("primary S03 duplicate-overlap review is stale");

    const fresh = await reviewFixtures();
    fresh.independent.group_discrepancies = [{ group_id: "DG-S03-0001" }];
    await expect(buildS03DuplicateOverlapAmendment(
      `${JSON.stringify(fresh.primary)}\n`, `${JSON.stringify(fresh.independent)}\n`,
      "2026-08-28T08:00:00.000Z",
    )).rejects.toThrow();
  }, 15_000);

  it("stores no source text and authorizes no selection, coding, traits, or activation", async () => {
    const text = await readFile(
      path.resolve("research/s03-duplicate-overlap-amendment-v1.json"), "utf8",
    );
    const artifact = JSON.parse(text);
    const forbidden = new Set([
      "sourceText", "source_text", "text", "content", "excerpt", "quote",
      "transcript", "lyrics", "recognizableExpressionContent",
    ]);
    const keys: string[] = [];
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) return value.forEach(visit);
      if (!value || typeof value !== "object") return;
      for (const [key, child] of Object.entries(value)) {
        keys.push(key);
        visit(child);
      }
    };
    visit(artifact);
    expect(keys.filter((key) => forbidden.has(key))).toEqual([]);
    expect(artifact).toMatchObject({
      sourceContentStored: false,
      selectionPerformed: false,
      observationCodingPerformed: false,
      traitAdmission: "prohibited",
      runtimeActivation: "prohibited",
    });
  });
});

async function reviewFixtures() {
  const [audit, capacity] = await Promise.all([
    loadS03DuplicateOverlapAudit(),
    loadPersonalityPreallocationCapacityManifestV1(),
  ]);
  const entry = capacity.ledgers.find((item) => item.sourceRegisterId === "S03")!;
  const ledger = preallocationCapacityLedgerSchema.parse(JSON.parse(await readFile(
    path.resolve(entry.ledgerArtifact), "utf8",
  )));
  const prerequisites = {
    source_register_fingerprint: audit.sourceRegisterFingerprint,
    boundary_protocol_fingerprint: ledger.boundaryProtocolFingerprint,
    high_risk_taxonomy_fingerprint: ledger.highRiskTaxonomyFingerprint,
    capacity_manifest_fingerprint: audit.capacityManifestFingerprint,
    capacity_ledger_artifact_fingerprint: audit.capacityLedgerArtifactFingerprint,
    capacity_ledger_fingerprint: audit.capacityLedgerFingerprint,
    sampling_plan_v4_outcome_fingerprint: audit.samplingPlanV4OutcomeFingerprint,
    source_content_fingerprint: ledger.sourceContentFingerprint,
    boundary_manifest_fingerprint: ledger.boundaryManifestFingerprint,
    ledger_fingerprint_map_fingerprint: ledger.ledgerFingerprintMapFingerprint,
  };
  const base = (role: "primary" | "independent") => ({
    schema_version: "personality-s03-duplicate-overlap-review-v1",
    review_role: role,
    reviewer: {
      reviewer_id: `${role}-fixture-reviewer`,
      tool: "deterministic fixture reproduction",
      model: "fixture-model",
      reviewed_at: role === "primary" ?
        "2026-08-28T07:43:50.074Z" : "2026-08-28T07:44:38.810Z",
    },
    audit_fingerprint: audit.auditFingerprint,
    prerequisite_fingerprints: prerequisites,
    counts: audit.counts,
    policy_verdict: "pass",
    group_discrepancies: [] as unknown[],
    rights_audit: {
      verdict: "pass",
      source_content_persisted: false,
      selection_performed: false,
      observation_coding_performed: false,
      runtime_activation: "prohibited",
    },
  });
  return { primary: base("primary"), independent: base("independent") };
}
