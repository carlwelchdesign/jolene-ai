import { describe, expect, it } from "vitest";

import { validatePersonalitySourcesV2 } from
  "../scripts/validate-personality-sources-v2.js";
import { personalitySourceEventSchema } from
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
  sourceContentFingerprint: `sha256:${"1".repeat(64)}`,
} as const;

describe("personality source register v2", () => {
  it("normalizes every v1 source and reports the honest coding-ready gaps", async () => {
    await expect(validatePersonalitySourcesV2()).resolves.toMatchObject({
      schemaVersion: "jolene.personality-source-register.v2",
      registeredEvents: 11,
      registeredPublisherFamilies: 8,
      codingReadyEvents: 9,
      codingReadyPublisherFamilies: 6,
      codingReadySettingFamilies: 6,
      codingReadyTimeBands: 3,
      metadataOnlyEvents: 1,
      unavailableEvents: 1,
      excludedEvents: 0,
      gateGaps: {
        sourceEvents: 1,
        publisherFamilies: 2,
        settingFamilies: 2,
        timeBands: 1,
      },
    });
  });

  it("produces a stable fingerprint for the unchanged register", async () => {
    const first = await validatePersonalitySourcesV2();
    const second = await validatePersonalitySourcesV2();
    expect(first.registerFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(second.registerFingerprint).toBe(first.registerFingerprint);
  });

  it("rejects coding-ready status without a verified fingerprinted boundary", () => {
    const result = personalitySourceEventSchema.safeParse({
      ...validSource,
      contentBoundaryVerified: false,
      fingerprintBasis: "none",
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
