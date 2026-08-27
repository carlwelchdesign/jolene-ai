import { describe, expect, it } from "vitest";

import {
  loadPersonalityCorpusV2Policy,
  validatePersonalityCorpusV2,
} from "../src/personality/personality-corpus-contract.js";
import type {
  IndependentReview,
  PersonalityCorpusV2,
  PersonalitySourceEvent,
  PersonalityTurn,
} from "../src/personality/personality-corpus-contract.js";

const digest = (value: string) => `sha256:${value.padStart(64, "0")}`;
const settings = [
  "adversarial-interview", "archival-interview", "first-person-statement", "formal-qa",
  "long-form-audio", "long-form-video", "public-service", "workplace-interview",
] as const;
const contexts = [
  "attribution", "boundaries", "care", "humor", "leadership", "recovery",
  "uncertainty", "work-practice",
] as const;
const traits = [
  "bounded-warmth", "calibrated-wit", "candid-repair", "credit-aware-authority",
  "disciplined-agency", "grounded-optimism", "operational-care", "uncertainty-humility",
] as const;
const timeBands = ["pre-2000", "2000s", "2010s", "2020s"] as const;

function fixture(): PersonalityCorpusV2 {
  const sources: PersonalitySourceEvent[] = Array.from({ length: 10 }, (_, index) => ({
    sourceEventId: `E${String(index + 1).padStart(3, "0")}`,
    sourceRegisterId: `S${String(index + 1).padStart(2, "0")}`,
    eventIdentity: `fixture-source-event-${index + 1}`,
    publisherFamilyId: `publisher-${(index % 8) + 1}`,
    editorialProgramId: `program-${index + 1}`,
    distributionHost: "example.com",
    isRebroadcast: false,
    lineageNote: "The fixture publisher is the originating editorial family and distribution host.",
    eventDateNote: "The synthetic fixture assigns an exact representative year for its controlled time band.",
    publisher: `Publisher ${(index % 8) + 1}`,
    title: `Source event ${index + 1}`,
    url: `https://example.com/source-${index + 1}`,
    effectiveUrl: `https://example.com/source-${index + 1}`,
    contentBoundaryUrl: `https://example.com/source-${index + 1}`,
    date: ["1998", "2005", "2015", "2022"][index % 4]!,
    timeBand: timeBands[index % 4]!,
    settingFamily: settings[index % 8]!,
    medium: index % 2 === 0 ? "text" : "audio",
    transcriptProvenance: "publisher-transcript",
    accessState: "coding-ready",
    accessReason: "The synthetic fixture provides a stable publisher transcript boundary for contract testing.",
    retrievalStatus: "retrieved",
    retrievedAt: "2026-08-27T12:00:00.000Z",
    retrievalHttpStatus: 200,
    retrievalContentType: "text/html",
    primarySourceVerified: true,
    contentBoundaryVerified: true,
    editorialTreatment: "raw",
    deliveryStructure: "unscripted",
    promotionalPurpose: "no",
    rightsBasis: "metadata-and-paraphrase-only",
    fingerprintBasis: "retrieved-response-bytes",
    fingerprintMethod: "raw-content-boundary-bytes-v1",
    sourceContentFingerprint: digest(String(index + 1)),
  }));
  const turns: PersonalityTurn[] = Array.from({ length: 120 }, (_, index) => {
    const source = sources[index % sources.length]!;
    return {
      observationId: `T${String(index + 1).padStart(3, "0")}`,
      sourceEventId: source.sourceEventId,
      sourceUrl: source.url,
      date: source.date,
      timeBand: source.timeBand,
      settingFamily: source.settingFamily,
      locator: { kind: "lines", start: index * 2, end: index * 2 + 1, label: `lines ${index * 2}-${index * 2 + 1}` },
      atomicSpeakerTurn: true,
      excerpt: null,
      paraphrase: `Distinct paraphrased observation number ${index + 1} describes a bounded communication behavior without copied expression.`,
      segmentFingerprint: digest(String(1000 + index)),
      sampleRuleId: "SAM-001",
      speechAct: "answer",
      researchContext: contexts[index % contexts.length]!,
      traitFamilyId: traits[index % traits.length]!,
      seriousnessPivot: index % 2 === 0,
      observationEvidenceClass: "observed",
      traitEvidenceClass: "inferred",
      adaptationEvidenceClass: "designed",
      confidence: "high",
      sensitiveStrata: [],
      alternativeInterpretation: "The public setting may reward a concise and polished answer.",
      doNotCopy: "Do not copy biography, dialect, quotations, jokes, or recognizable phrasing.",
      primaryReviewer: {
        reviewerId: "primary-reviewer", reviewerType: "ai", tool: "Codex",
        modelVersion: "test-model", codedAt: "2026-08-27T12:00:00.000Z",
      },
    };
  });
  const independentReviews: IndependentReview[] = turns.slice(0, 40).map((turn, index) => ({
    observationId: turn.observationId,
    independentAssignmentFingerprint: digest(String(2000 + index)),
    reviewerId: "independent-reviewer",
    reviewerType: "ai",
    tool: "Codex",
    modelVersion: "test-model",
    assignedAt: "2026-08-27T12:01:00.000Z",
    codedAt: "2026-08-27T12:02:00.000Z",
    primaryRawCoding: {
      speechAct: turn.speechAct,
      researchContext: turn.researchContext,
      traitFamilyId: turn.traitFamilyId,
      seriousnessPivot: turn.seriousnessPivot,
    },
    rawCoding: {
      speechAct: turn.speechAct,
      researchContext: turn.researchContext,
      traitFamilyId: turn.traitFamilyId,
      seriousnessPivot: turn.seriousnessPivot,
    },
    reconciledAt: "2026-08-27T12:03:00.000Z",
    adjudicatorId: "adjudicator-reviewer",
    disposition: "agree",
    changedFields: [],
  }));
  return {
    schemaVersion: "jolene.personality-corpus.v2",
    samplingPlanFingerprint: digest("9999"),
    sources,
    turns,
    independentReviews,
    traitAdmissions: [],
  };
}

describe("personality corpus v2 contract", () => {
  it("loads the non-activating, rights-conscious policy", async () => {
    await expect(loadPersonalityCorpusV2Policy()).resolves.toMatchObject({
      schema_version: "personality-corpus-v2",
      status: "contract-only",
      runtime_activation: "prohibited",
      eligibility: { minimum_atomic_turns: 100, maximum_atomic_turns: 150 },
    });
  });

  it("accepts a source-balanced corpus with independently reviewed coverage", async () => {
    const policy = await loadPersonalityCorpusV2Policy();
    expect(validatePersonalityCorpusV2(fixture(), policy)).toMatchObject({
      eligibleTurns: 120,
      sourceEvents: 10,
      publisherFamilies: 8,
      settingFamilies: 8,
      researchContexts: 8,
      timeBands: 4,
      independentReviews: 40,
      rawCategoricalAgreement: 1,
      traitFamilyKappa: 1,
      runtimeActivation: "prohibited",
    });
  });

  it("rejects source concentration even when the row count passes", async () => {
    const policy = await loadPersonalityCorpusV2Policy();
    const corpus = fixture();
    const dominant = corpus.sources[0]!;
    const turns = corpus.turns.map((turn, index) => index < 25 ? {
      ...turn,
      sourceEventId: dominant.sourceEventId,
      sourceUrl: dominant.url,
      date: dominant.date,
      timeBand: dominant.timeBand,
      settingFamily: dominant.settingFamily,
    } : turn);
    expect(() => validatePersonalityCorpusV2({ ...corpus, turns }, policy))
      .toThrow("Maximum source event share exceeded");
  });

  it("rejects a second review performed by the primary reviewer", async () => {
    const policy = await loadPersonalityCorpusV2Policy();
    const corpus = fixture();
    const reviews = corpus.independentReviews.map((review, index) => index === 0 ? {
      ...review, reviewerId: "primary-reviewer",
    } : review);
    expect(() => validatePersonalityCorpusV2({ ...corpus, independentReviews: reviews }, policy))
      .toThrow("Independent reviewer matches primary reviewer");
  });

  it("rejects missing review for a sensitive or low-confidence turn", async () => {
    const policy = await loadPersonalityCorpusV2Policy();
    const corpus = fixture();
    const turns = corpus.turns.map((turn, index) => index === 80 ? {
      ...turn, confidence: "low" as const, sensitiveStrata: ["humor" as const],
    } : turn);
    expect(() => validatePersonalityCorpusV2({ ...corpus, turns }, policy))
      .toThrow("Mandatory independent review missing for T081");
  });

  it("rejects source metadata that assigns the wrong time band", async () => {
    const policy = await loadPersonalityCorpusV2Policy();
    const corpus = fixture();
    const sources = corpus.sources.map((source, index) => index === 0 ? {
      ...source, timeBand: "2020s" as const,
    } : source);
    expect(() => validatePersonalityCorpusV2({ ...corpus, sources }, policy))
      .toThrow("Source date and time band disagree");
  });

  it("rejects overlapping locators within one source event", async () => {
    const policy = await loadPersonalityCorpusV2Policy();
    const corpus = fixture();
    const turns = corpus.turns.map((turn, index) => index === 10 ? {
      ...turn, locator: { ...turn.locator, start: 0, end: 1, label: "lines 0-1" },
    } : turn);
    expect(() => validatePersonalityCorpusV2({ ...corpus, turns }, policy))
      .toThrow("Overlapping personality locators in E001:lines");
  });

  it("rejects normalized duplicate paraphrases", async () => {
    const policy = await loadPersonalityCorpusV2Policy();
    const corpus = fixture();
    const turns = corpus.turns.map((turn, index) => index === 1 ? {
      ...turn, paraphrase: corpus.turns[0]!.paraphrase.toUpperCase(),
    } : turn);
    expect(() => validatePersonalityCorpusV2({ ...corpus, turns }, policy))
      .toThrow("Duplicate normalized paraphrase");
  });
});
