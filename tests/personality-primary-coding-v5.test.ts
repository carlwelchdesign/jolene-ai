import { describe, expect, it } from "vitest";

import {
  buildPrimaryCodingArtifactV5,
  loadPersonalityPrimaryCodingPrerequisitesV5,
  personalityPrimaryCodingArtifactV5Schema,
  validatePersonalityPrimaryCodingArtifactV5,
} from "../src/personality/personality-primary-coding-v5.js";

async function fixture() {
  const { selection, register } = await loadPersonalityPrimaryCodingPrerequisitesV5();
  const selected = selection.ledgers.flatMap((ledger) => ledger.selectedUnits.map((unit) => ({
    ledger, unit,
  })));
  const codedAt = "2026-08-28T09:00:00.000Z";
  const reviewer = {
    reviewerId: "codex-primary-reviewer",
    reviewerType: "ai" as const,
    tool: "OpenAI Responses API structured primary coding; store=false",
    modelVersion: "test-model",
  };
  const contexts = [
    "attribution", "boundaries", "care", "humor", "leadership", "recovery",
    "uncertainty", "work-practice",
  ] as const;
  const traits = [
    "bounded-warmth", "calibrated-wit", "candid-repair", "credit-aware-authority",
    "disciplined-agency", "grounded-optimism", "operational-care",
    "uncertainty-humility",
  ] as const;
  const sourceByEvent = new Map(register.events.map((source) => [source.sourceEventId, source]));
  const turns = selected.map(({ ledger, unit }, index) => {
    const source = sourceByEvent.get(ledger.sourceEventId)!;
    return {
      observationId: `T${String(index + 1).padStart(3, "0")}`,
      sourceEventId: ledger.sourceEventId,
      sourceUrl: source.url,
      date: source.date,
      timeBand: source.timeBand,
      settingFamily: source.settingFamily,
      locator: unit.locator,
      atomicSpeakerTurn: true as const,
      excerpt: null,
      paraphrase: `Unique paraphrased observation ${index + 1} records a bounded public communication behavior without copied expression.`,
      segmentFingerprint: unit.segmentFingerprint,
      sampleRuleId: unit.selectionRuleId,
      speechAct: "answer" as const,
      researchContext: contexts[index % contexts.length]!,
      traitFamilyId: traits[index % traits.length]!,
      seriousnessPivot: index % 2 === 0,
      observationEvidenceClass: "observed" as const,
      traitEvidenceClass: index < 24 ? "rejected" as const : "inferred" as const,
      adaptationEvidenceClass: index < 24 ? "rejected" as const : "designed" as const,
      confidence: "medium" as const,
      sensitiveStrata: unit.agreedHighRiskStrata,
      alternativeInterpretation: "The public setting and edited format may shape the observed behavior.",
      doNotCopy: "Do not copy identity, biography, dialect, beliefs, jokes, quotations, or recognizable wording.",
      primaryReviewer: { ...reviewer, codedAt },
    };
  });
  return buildPrimaryCodingArtifactV5({
    codedAt,
    selectionManifestFingerprint: selection.manifestFingerprint,
    samplingPlanFingerprint: selection.ledgers[0]!.samplingPlanFingerprint,
    sourceRegisterFingerprint: register.registerFingerprint,
    primaryReviewer: reviewer,
    turns,
  });
}

describe("personality primary coding v5", () => {
  it("accepts an exact paraphrase-only 120-turn primary baseline", async () => {
    await expect(validatePersonalityPrimaryCodingArtifactV5(await fixture())).resolves.toEqual({
      turns: 120,
      sources: 10,
      researchContexts: 8,
      rejectedTraitTurns: 24,
      rejectedAdaptationTurns: 24,
      runtimeActivation: "prohibited",
    });
  }, 30_000);

  it("rejects any observation that drifts from the frozen selection", async () => {
    const artifact = await fixture();
    const turns = artifact.turns.map((turn, index) => index === 0 ? {
      ...turn, segmentFingerprint: `sha256:${"0".repeat(64)}`,
    } : turn);
    await expect(validatePersonalityPrimaryCodingArtifactV5({ ...artifact, turns }))
      .rejects.toThrow("is not bound to frozen selection");
  }, 30_000);

  it("rejects a positive-only baseline", async () => {
    const artifact = await fixture();
    const turns = artifact.turns.map((turn) => ({
      ...turn, traitEvidenceClass: "inferred" as const,
      adaptationEvidenceClass: "designed" as const,
    }));
    await expect(validatePersonalityPrimaryCodingArtifactV5({ ...artifact, turns }))
      .rejects.toThrow("lacks the precommitted negative/counterexample baseline");
  }, 30_000);

  it("rejects persisted excerpts and activation at the schema boundary", async () => {
    const artifact = await fixture();
    expect(() => buildPrimaryCodingArtifactV5({
      codedAt: artifact.codedAt,
      selectionManifestFingerprint: artifact.selectionManifestFingerprint,
      samplingPlanFingerprint: artifact.samplingPlanFingerprint,
      sourceRegisterFingerprint: artifact.sourceRegisterFingerprint,
      primaryReviewer: artifact.primaryReviewer,
      turns: artifact.turns.map((turn, index) => index === 0
        ? { ...turn, excerpt: "copied source text" as never }
        : turn),
    })).toThrow();
    expect(() => personalityPrimaryCodingArtifactV5Schema.parse({
      ...artifact, runtimeActivation: "allowed",
    })).toThrow();
  });
});
