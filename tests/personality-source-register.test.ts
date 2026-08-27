import { describe, expect, it } from "vitest";

import { validatePersonalitySourcesV2 } from
  "../scripts/validate-personality-sources-v2.js";
import { personalitySourceEventSchema } from
  "../src/personality/personality-source-register.js";
import { loadPersonalitySourceRegisterV2 } from
  "../src/personality/personality-source-register.js";

const validSource = {
  sourceEventId: "E001",
  sourceRegisterId: "S01",
  eventIdentity: "fixture-source-event-one",
  publisherFamilyId: "fixture-publisher",
  editorialProgramId: "fixture-program",
  distributionHost: "example.com",
  isRebroadcast: false,
  lineageNote: "The fixture publisher is both the editorial origin and distribution host.",
  eventDateNote: "The fixture uses an exact representative date for the controlled time band.",
  publisher: "Fixture Publisher",
  title: "Fixture source event",
  url: "https://example.com/source",
  effectiveUrl: "https://example.com/source",
  contentBoundaryUrl: "https://example.com/source",
  date: "2008-01-01",
  timeBand: "2000s",
  settingFamily: "long-form-audio",
  medium: "audio",
  transcriptProvenance: "publisher-transcript",
  accessState: "coding-ready",
  accessReason: "The fixture has a stable publisher transcript with addressable atomic turns.",
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
  sourceContentFingerprint: `sha256:${"1".repeat(64)}`,
} as const;

describe("personality source register v2", () => {
  it("preserves every v1 source and closes the precommitted diversity gate", async () => {
    await expect(validatePersonalitySourcesV2()).resolves.toMatchObject({
      schemaVersion: "jolene.personality-source-register.v2",
      registeredEvents: 14,
      legacyNormalizedEvents: 11,
      newlyRegisteredEvents: 3,
      registeredPublisherFamilies: 11,
      registeredSettingFamilies: 10,
      codingReadyEvents: 11,
      codingReadyPublisherFamilies: 9,
      codingReadySettingFamilies: 8,
      codingReadyTimeBands: 4,
      metadataOnlyEvents: 1,
      unavailableEvents: 1,
      excludedEvents: 1,
      liveFingerprintPolicy: {
        requiredSourceIds: [
          "S02", "S03", "S04", "S05", "S07", "S08", "S09", "S13", "S16", "S17", "S18",
        ],
        allowedOrigins: [
          "https://freshairarchive.org", "https://transcripts.cnn.com",
          "https://www.press.org", "https://www.wfae.org", "https://www.wprl.org",
          "https://danratherjournalist.org", "https://www.loc.gov", "https://www.ted.com",
          "https://blankonblank.org", "https://www.wired.com",
          "https://cdn.imaginationlibrary.com",
        ],
        timeoutMs: 15000,
        maximumResponseBytes: 2500000,
        maximumRedirects: 2,
      },
      gateGaps: {
        sourceEvents: 0,
        publisherFamilies: 0,
        settingFamilies: 0,
        timeBands: 0,
      },
    });
  });

  it("produces a stable fingerprint for the unchanged register", async () => {
    const first = await validatePersonalitySourcesV2();
    const second = await validatePersonalitySourcesV2();
    expect(first.registerFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(second.registerFingerprint).toBe(first.registerFingerprint);
  });

  it("registers the two independently published gate-closing events", async () => {
    const snapshot = await loadPersonalitySourceRegisterV2();
    expect(snapshot.events.filter((source) => source.sourceRegisterId === "S16" ||
      source.sourceRegisterId === "S17").map((source) => ({
      sourceRegisterId: source.sourceRegisterId,
      publisherFamilyId: source.publisherFamilyId,
      settingFamily: source.settingFamily,
      timeBand: source.timeBand,
      accessState: source.accessState,
    }))).toEqual([
      {
        sourceRegisterId: "S16",
        publisherFamilyId: "playboy-blank-on-blank",
        settingFamily: "informal-candid-interview",
        timeBand: "pre-2000",
        accessState: "coding-ready",
      },
      {
        sourceRegisterId: "S17",
        publisherFamilyId: "wired",
        settingFamily: "structured-prompt-interview",
        timeBand: "2020s",
        accessState: "coding-ready",
      },
    ]);
  });

  it("excludes unattributed S10 captions and admits the first-party S18 statement", async () => {
    const snapshot = await loadPersonalitySourceRegisterV2();
    expect(snapshot.events.find((source) => source.sourceRegisterId === "S10")).toMatchObject({
      accessState: "excluded",
      fingerprintMethod: "raw-vtt-bytes-v1",
      contentBoundaryVerified: true,
    });
    expect(snapshot.events.find((source) => source.sourceRegisterId === "S18")).toMatchObject({
      sourceEventId: "E014",
      publisherFamilyId: "dollywood-foundation",
      settingFamily: "first-person-statement",
      transcriptProvenance: "first-party-statement",
      accessState: "coding-ready",
      fingerprintMethod: "raw-pdf-bytes-v1",
      sourceContentFingerprint:
        "sha256:84a71eb6ff4ad76c571cceb1ba2517857bf1226971585dcbf0915d1f6ef32666",
    });
  });

  it("keeps ABC metadata-only until timed captions pass audiovisual review", async () => {
    const snapshot = await loadPersonalitySourceRegisterV2();
    expect(snapshot.events.find((source) => source.sourceRegisterId === "S01")).toMatchObject({
      accessState: "metadata-only",
      transcriptProvenance: "metadata-only",
      fingerprintBasis: "retrieved-response-bytes",
      contentBoundaryVerified: false,
      sourceContentFingerprint:
        "sha256:fdf3212a1865bee419c9dec2bc30bcbb4b5c0d97cbc6b25121127e2aec2a0c6f",
    });
  });

  it("rejects coding-ready status without a verified fingerprinted boundary", () => {
    const result = personalitySourceEventSchema.safeParse({
      ...validSource,
      contentBoundaryVerified: false,
      fingerprintBasis: "none",
      fingerprintMethod: "none",
      sourceContentFingerprint: null,
    });
    expect(result.success).toBe(false);
  });

  it("rejects metadata-only status that claims a codable transcript", () => {
    const result = personalitySourceEventSchema.safeParse({
      ...validSource,
      accessState: "metadata-only",
      transcriptProvenance: "metadata-only",
    });
    expect(result.success).toBe(false);
  });

  it("rejects unavailable status that claims retrieved fingerprinted content", () => {
    const result = personalitySourceEventSchema.safeParse({
      ...validSource,
      accessState: "unavailable",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a date assigned to the wrong time band", () => {
    const result = personalitySourceEventSchema.safeParse({
      ...validSource,
      timeBand: "2020s",
    });
    expect(result.success).toBe(false);
  });
});
