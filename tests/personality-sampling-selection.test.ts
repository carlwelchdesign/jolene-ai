import { describe, expect, it } from "vitest";

import {
  fingerprintSamplingUnitSegments,
  systematicMidpointOrdinals,
  validateAndSelectPersonalityLedgerSource,
} from "../src/personality/personality-sampling-selection.js";
import type { SourceSelectionLedger } from
  "../src/personality/personality-sampling-selection.js";
import type { PersonalitySamplingPlan } from
  "../src/personality/personality-sampling-plan.js";
import type { PersonalitySamplingPlanSnapshot } from
  "../src/personality/personality-sampling-plan.js";

const hash = (value: number) => `sha256:${String(value).padStart(64, "0")}`;

describe("personality sampling selection", () => {
  it("fingerprints normalized source segments without storing their content", () => {
    expect(fingerprintSamplingUnitSegments([" First  turn ", "Second\nturn"]))
      .toBe(fingerprintSamplingUnitSegments(["First turn", "Second turn"]));
    expect(() => fingerprintSamplingUnitSegments([])).toThrow("requires source segments");
  });

  it("recomputes exact midpoint ordinals without endpoint cherry-picking", () => {
    expect(systematicMidpointOrdinals(20, 6)).toEqual([1, 5, 8, 11, 15, 18]);
    expect(() => systematicMidpointOrdinals(5, 6)).toThrow("smaller");
  });

  it("selects systematic units and deterministic first remaining high-risk matches", () => {
    const result = validateAndSelectPersonalityLedgerSource(snapshot(), ledger());
    expect(result).toMatchObject({
      eligibleUnits: 8,
      excludedRanges: 2,
      systematicTurns: 2,
      purposiveHighRiskTurns: 2,
    });
    expect(result.selectedUnits.map((unit) => ({
      ordinal: unit.eligibleOrdinal,
      rule: unit.sampleRuleId,
      stratum: unit.primaryHighRiskStratum,
    }))).toEqual([
      { ordinal: 0, rule: "SAM-002", stratum: "boundary" },
      { ordinal: 2, rule: "SAM-001", stratum: null },
      { ordinal: 5, rule: "SAM-002", stratum: "humor" },
      { ordinal: 6, rule: "SAM-001", stratum: null },
    ]);
  });

  it("fails incomplete or overlapping source-boundary coverage", () => {
    const missing = ledger();
    missing.excludedUnits = missing.excludedUnits.slice(0, 1);
    expect(() => validateAndSelectPersonalityLedgerSource(snapshot(), missing))
      .toThrow("coverage is missing or overlapping");
    const overlap = ledger();
    overlap.excludedUnits[1]!.sourceUnitStart = 8;
    expect(() => validateAndSelectPersonalityLedgerSource(snapshot(), overlap))
      .toThrow("coverage is missing or overlapping");
  });

  it("fails when predeclared high-risk strata cannot fill the allocation", () => {
    const noRisk = ledger();
    noRisk.eligibleUnits = noRisk.eligibleUnits.map((unit) => ({ ...unit, highRiskStrata: [] }));
    expect(() => validateAndSelectPersonalityLedgerSource(snapshot(), noRisk))
      .toThrow("cannot satisfy");
  });

  it("binds entry IDs and locator kinds to the allocated source", () => {
    const wrongId = ledger();
    wrongId.eligibleUnits[0]!.universeEntryId = "U-S99-0001";
    expect(() => validateAndSelectPersonalityLedgerSource(snapshot(), wrongId))
      .toThrow("ID prefix mismatch");
    const wrongLocator = ledger();
    wrongLocator.eligibleUnits[0]!.locator.kind = "section-index";
    expect(() => validateAndSelectPersonalityLedgerSource(snapshot(), wrongLocator))
      .toThrow("locator kind mismatch");
  });

  it("rejects a superseded plan before it can drive S10 selection", () => {
    const failedPlan = snapshot();
    const first = failedPlan.plan.source_allocations[0];
    if (!first) throw new Error("Missing failed-plan allocation fixture");
    first.source_register_id = "S10";
    first.source_event_id = "E009";
    first.locator_unit = "timestamp";
    first.segmentation_rule = "vtt-speaker-cue-blocks-v1";
    expect(() => validateAndSelectPersonalityLedgerSource({
      ...failedPlan, sourceRegisterState: "superseded-after-recorded-failure",
    }, ledger())).toThrow("Superseded sampling plan cannot drive selection");
  });
});

const planFingerprint = hash(900);

function snapshot(): PersonalitySamplingPlanSnapshot {
  return {
    schemaVersion: "jolene.personality-sampling-plan.v2",
    planFingerprint,
    createdAt: "2026-08-27T09:00:00.000Z",
    sourceRegisterFingerprint: hash(901),
    sourceRegisterState: "current",
    targetAtomicTurns: 120,
    systematicTurns: 96,
    purposiveHighRiskTurns: 24,
    sourceEvents: 11,
    publisherFamilies: 8,
    settingFamilies: 8,
    timeBands: 4,
    runtimeActivation: "prohibited",
    plan: plan(),
  };
}

function plan(): PersonalitySamplingPlan {
  return {
    schema_version: "personality-sampling-plan-v2",
    status: "precommitted",
    runtime_activation: "prohibited",
    created_at: "2026-08-27T09:00:00.000Z",
    source_register: {
      schema_version: "jolene.personality-source-register.v2",
      fingerprint: hash(901),
      reviewed_at: "2026-08-27T08:42:18.000Z",
    },
    target_atomic_turns: 120,
    selection_rules: {
      systematic: {
        rule_id: "SAM-001", target_turns: 96,
        algorithm: "eligible-target-speaker-universe-even-midpoint-v1",
        source_order: "publisher-boundary-order", blind_to_trait_outcomes: true,
      },
      purposive_high_risk: {
        rule_id: "SAM-002", target_turns: 24,
        algorithm: "remaining-eligible-source-order-first-match-v1",
        strata_priority: [
          "boundary", "contradiction", "grief-or-hurt", "humor",
          "workplace-sexual-boundary", "voice-adjacent", "identity-trait",
          "politics", "belief", "biography",
        ],
        blind_to_fame_and_quotability: true,
      },
      selected_ids_immutable_after_ledger_freeze: true,
      outcome_based_replacement: "prohibited",
      failed_post_selection_gate: "requires-new-prospective-plan-version",
    },
    stratum_definitions: {
      belief: "explicit religion spirituality or moral-conviction discussion",
      biography: "personal history family health relationship or career-history account",
      boundary: "explicit refusal limit condition correction or protected line",
      contradiction: "explicit tension change counterevidence or competing claim",
      "grief-or-hurt": "loss injury shame failure grief or described emotional pain",
      humor: "observable joke wordplay self-deprecation comic reversal or laughter cue",
      "identity-trait": "explicit self-description as a type of person or stable attribute",
      politics: "policy elected office civic controversy or partisan positioning",
      "voice-adjacent": "accent singing vocal sound or voice-performance discussion",
      "workplace-sexual-boundary": "workplace conduct harassment sexualized treatment or appearance boundary",
    },
    eligibility: {
      target_speaker_only: true, atomic_turn_required: true,
      coding_ready_source_required: true, stable_locator_required: true,
      source_segment_fingerprint_required: true,
    },
    exclusion_reasons: [
      "advertisement-or-promotion", "duplicate-or-overlap", "interviewer-or-other-speaker",
      "lyric-or-performance", "non-verbal", "not-atomic", "speaker-attribution-unclear",
      "too-fragmentary", "unreviewable-boundary",
    ],
    balance_guards: {
      minimum_source_events: 10, minimum_publisher_families: 8,
      minimum_setting_families: 8, minimum_time_bands: 4,
      maximum_source_share: 0.15, maximum_publisher_share: 0.20,
      maximum_time_band_share: 0.40,
    },
    post_selection_acceptance: {
      minimum_research_contexts: 8, minimum_turns_per_context: 5,
      minimum_sources_per_context: 2, minimum_rejected_trait_evidence_turns: 24,
      minimum_rejected_adaptation_turns: 24,
    },
    source_allocations: [{
      source_register_id: "S02", source_event_id: "E002", target_turns: 4,
      systematic_turns: 2, purposive_high_risk_turns: 2,
      locator_unit: "paragraph-index", segmentation_rule: "paragraph-speaker-blocks-v1",
    }, ...Array.from({ length: 10 }, (_, index) => ({
      source_register_id: `S${String(index + 20).padStart(2, "0")}`,
      source_event_id: `E${String(index + 20).padStart(3, "0")}`,
      target_turns: index === 0 ? 8 : 12,
      systematic_turns: index === 0 ? 6 : 10,
      purposive_high_risk_turns: 2,
      locator_unit: "section-index" as const,
      segmentation_rule: "pdf-speaker-label-blocks-v1" as const,
    }))],
    rights: {
      repository_storage: "metadata-and-paraphrase-only", excerpts: "prohibited",
      lyrics: "prohibited", transcript_audio_video_storage: "prohibited",
      recognizable_expression: "prohibited", biography_or_belief_transfer: "prohibited",
      dialect_imitation: "prohibited", default_intimacy: "prohibited",
      voice_imitation: "prohibited",
    },
    next_stage: {
      independent_review: "required-separate-ticket", trait_admission: "prohibited",
      owner_decision: "not-requested",
    },
  };
}

function ledger(): SourceSelectionLedger {
  const reviewer = {
    reviewerId: "eligibility-reviewer", reviewerType: "ai" as const, tool: "Codex",
    modelVersion: "test-model", classifiedAt: "2026-08-27T09:10:00.000Z",
  };
  return {
    schemaVersion: "jolene.personality-source-selection-ledger.v2",
    samplingPlanFingerprint: planFingerprint,
    sourceRegisterFingerprint: hash(901),
    sourceRegisterId: "S02",
    sourceEventId: "E002",
    sourceBoundaryUnitCount: 10,
    segmentationRule: "paragraph-speaker-blocks-v1",
    eligibleUnits: Array.from({ length: 8 }, (_, index) => ({
      universeEntryId: `U-S02-${String(index + 1).padStart(4, "0")}`,
      sourceRegisterId: "S02", sourceEventId: "E002",
      sourceUnitOrdinal: index < 4 ? index : index + 1,
      eligibleOrdinal: index,
      segmentationRule: "paragraph-speaker-blocks-v1" as const,
      locator: { kind: "paragraph-index" as const, start: index, end: index, label: `unit ${index}` },
      segmentFingerprint: hash(index + 1),
      highRiskStrata: index === 0 ? ["boundary" as const] :
        index === 5 ? ["humor" as const] : [],
      reviewer,
    })),
    excludedUnits: [
      {
        exclusionId: "X-S02-0001", sourceRegisterId: "S02", sourceEventId: "E002",
        sourceUnitStart: 4, sourceUnitEnd: 4,
        segmentationRule: "paragraph-speaker-blocks-v1",
        locator: { kind: "paragraph-index", start: 4, end: 4, label: "unit 4" },
        segmentFingerprint: hash(100), reason: "interviewer-or-other-speaker", reviewer,
      },
      {
        exclusionId: "X-S02-0002", sourceRegisterId: "S02", sourceEventId: "E002",
        sourceUnitStart: 9, sourceUnitEnd: 9,
        segmentationRule: "paragraph-speaker-blocks-v1",
        locator: { kind: "paragraph-index", start: 9, end: 9, label: "unit 9" },
        segmentFingerprint: hash(101), reason: "too-fragmentary", reviewer,
      },
    ],
    sourceContentStored: false,
    frozenBeforeSelectionAndCoding: true,
  };
}
