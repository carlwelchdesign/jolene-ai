import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { parse } from "yaml";
import { z } from "zod";

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const sourceRegisterIdSchema = z.string().regex(/^S\d{2}$/);

export const timeBandSchema = z.enum(["pre-2000", "2000s", "2010s", "2020s"]);
export const settingFamilySchema = z.enum([
  "adversarial-interview", "archival-interview", "first-person-statement",
  "formal-qa", "informal-candid-interview", "long-form-audio", "long-form-video",
  "public-service", "structured-prompt-interview", "workplace-interview",
]);

export const personalitySourceEventSchema = z.object({
  sourceEventId: z.string().regex(/^E\d{3}$/),
  sourceRegisterId: sourceRegisterIdSchema,
  eventIdentity: z.string().regex(/^[a-z0-9][a-z0-9-]{5,127}$/),
  publisherFamilyId: z.string().regex(/^[a-z0-9][a-z0-9-]{2,63}$/),
  editorialProgramId: z.string().regex(/^[a-z0-9][a-z0-9-]{2,63}$/).nullable(),
  distributionHost: z.string().min(1),
  isRebroadcast: z.boolean(),
  lineageNote: z.string().min(20),
  eventDateNote: z.string().min(20),
  publisher: z.string().min(1),
  title: z.string().min(1),
  url: z.string().url(),
  effectiveUrl: z.string().url().nullable(),
  contentBoundaryUrl: z.string().url().nullable(),
  date: z.string().regex(/^\d{4}(?:-\d{2}-\d{2})?$/),
  timeBand: timeBandSchema,
  settingFamily: settingFamilySchema,
  medium: z.enum(["audio", "text", "video"]),
  transcriptProvenance: z.enum([
    "edited-primary-highlights", "first-party-statement", "metadata-only",
    "official-archive-transcript", "official-caption-track", "official-publisher-reprint",
    "publisher-questionnaire", "publisher-transcript",
  ]),
  accessState: z.enum(["coding-ready", "excluded", "metadata-only", "unavailable"]),
  accessReason: z.string().min(20),
  retrievalStatus: z.enum(["blocked", "redirected-away", "retrieved"]),
  retrievedAt: z.string().datetime(),
  retrievalHttpStatus: z.number().int().min(100).max(599),
  retrievalContentType: z.string().min(1).nullable(),
  primarySourceVerified: z.boolean(),
  contentBoundaryVerified: z.boolean(),
  editorialTreatment: z.enum(["edited", "edited-highlights", "raw", "rebroadcast", "unknown"]),
  deliveryStructure: z.enum(["mixed", "scripted", "unknown", "unscripted"]),
  promotionalPurpose: z.enum(["mixed", "no", "unknown", "yes"]),
  rightsBasis: z.literal("metadata-and-paraphrase-only"),
  fingerprintBasis: z.enum([
    "none", "normalized-transcript-segments", "official-caption-bytes",
    "retrieved-response-bytes",
  ]),
  fingerprintMethod: z.enum([
    "none", "raw-content-boundary-bytes-v1", "raw-pdf-bytes-v1", "raw-vtt-bytes-v1",
    "fresh-air-transcript-paragraphs-v1",
    "cnn-transcript-body-paragraphs-v1",
    "npr-station-article-body-paragraphs-v1",
    "ted-next-data-transcript-segments-v1",
    "blank-on-blank-transcript-paragraphs-v1",
    "interview-magazine-speaker-paragraphs-v1",
    "vanity-fair-proust-pairs-v1",
    "wired-indexed-transcript-captions-v1",
  ]),
  sourceContentFingerprint: sha256Schema.nullable(),
}).superRefine((source, context) => {
  if (source.timeBand !== timeBandForDate(source.date)) {
    context.addIssue({ code: "custom", message: "Source date and time band disagree" });
  }
  if (source.accessState === "coding-ready") {
    if (!source.primarySourceVerified || !source.contentBoundaryVerified ||
        source.retrievalStatus !== "retrieved" || source.sourceContentFingerprint === null ||
        source.fingerprintBasis === "none" || source.contentBoundaryUrl === null ||
        source.transcriptProvenance === "metadata-only") {
      context.addIssue({
        code: "custom",
        message: "Coding-ready source lacks verified, fingerprinted content provenance",
      });
    }
  }
  if (source.accessState === "metadata-only" &&
      (source.contentBoundaryVerified || source.contentBoundaryUrl !== null ||
       source.transcriptProvenance !== "metadata-only")) {
    context.addIssue({
      code: "custom",
      message: "Metadata-only source cannot claim a codable content boundary",
    });
  }
  if (source.accessState === "unavailable" &&
      (source.contentBoundaryVerified || source.contentBoundaryUrl !== null ||
       source.sourceContentFingerprint !== null || source.retrievalStatus === "retrieved")) {
    context.addIssue({
      code: "custom",
      message: "Unavailable source cannot claim retrieved or fingerprinted content",
    });
  }
  if ((source.fingerprintBasis === "none") !== (source.sourceContentFingerprint === null)) {
    context.addIssue({ code: "custom", message: "Source fingerprint and basis disagree" });
  }
  if ((source.fingerprintMethod === "none") !== (source.sourceContentFingerprint === null)) {
    context.addIssue({ code: "custom", message: "Source fingerprint and method disagree" });
  }
  const normalizedMethods = new Set([
    "fresh-air-transcript-paragraphs-v1",
    "cnn-transcript-body-paragraphs-v1",
    "npr-station-article-body-paragraphs-v1",
    "ted-next-data-transcript-segments-v1",
    "blank-on-blank-transcript-paragraphs-v1",
    "interview-magazine-speaker-paragraphs-v1",
    "vanity-fair-proust-pairs-v1",
    "wired-indexed-transcript-captions-v1",
  ]);
  if ((source.fingerprintBasis === "normalized-transcript-segments") !==
      normalizedMethods.has(source.fingerprintMethod)) {
    context.addIssue({
      code: "custom",
      message: "Normalized transcript fingerprint basis and method disagree",
    });
  }
});

const sourceRegisterV2Schema = z.object({
  schema_version: z.literal("personality-source-register-v2"),
  status: z.literal("normalized-non-activating"),
  reviewed_at: z.string().datetime(),
  rights_policy: z.object({
    repository_storage: z.literal("metadata-and-paraphrase-only"),
    transcript_storage: z.literal("prohibited"),
    lyrics_storage: z.literal("prohibited"),
    audio_video_storage: z.literal("prohibited"),
    content_fingerprint_storage: z.literal("sha256-only"),
  }),
  live_fingerprint_verification: z.object({
    required_source_ids: z.array(sourceRegisterIdSchema).min(1),
    allowed_origins: z.array(z.string().url()).min(1),
    timeout_ms: z.number().int().min(1_000).max(30_000),
    maximum_response_bytes: z.number().int().min(1_024).max(5_000_000),
    maximum_redirects: z.number().int().min(0).max(5),
  }),
  publisher_families: z.array(z.object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{2,63}$/),
    label: z.string().min(1),
    distribution_hosts: z.array(z.string().min(1)).min(1),
    independence_note: z.string().min(20),
  })).min(1),
  setting_families: z.array(z.object({
    id: settingFamilySchema,
    classification_priority: z.number().int().positive(),
    definition: z.string().min(20),
    distinguishing_rule: z.string().min(20),
  })).min(1),
  events: z.array(personalitySourceEventSchema).min(1),
});

const legacyRegisterSchema = z.object({
  sources: z.array(z.object({
    id: z.string().regex(/^S\d{2}$/),
    url: z.string().url(),
  })),
});

export type PersonalitySourceEvent = z.infer<typeof personalitySourceEventSchema>;
export type PersonalitySourceRegisterV2 = z.infer<typeof sourceRegisterV2Schema>;

export interface PersonalitySourceRegisterSnapshot {
  readonly schemaVersion: "jolene.personality-source-register.v2";
  readonly registerFingerprint: string;
  readonly reviewedAt: string;
  readonly registeredEvents: number;
  readonly legacyNormalizedEvents: number;
  readonly newlyRegisteredEvents: number;
  readonly registeredPublisherFamilies: number;
  readonly registeredSettingFamilies: number;
  readonly codingReadyEvents: number;
  readonly codingReadyPublisherFamilies: number;
  readonly codingReadySettingFamilies: number;
  readonly codingReadyTimeBands: number;
  readonly metadataOnlyEvents: number;
  readonly unavailableEvents: number;
  readonly excludedEvents: number;
  readonly liveFingerprintPolicy: {
    readonly requiredSourceIds: readonly string[];
    readonly allowedOrigins: readonly string[];
    readonly timeoutMs: number;
    readonly maximumResponseBytes: number;
    readonly maximumRedirects: number;
  };
  readonly gateGaps: {
    readonly sourceEvents: number;
    readonly publisherFamilies: number;
    readonly settingFamilies: number;
    readonly timeBands: number;
  };
  readonly events: readonly PersonalitySourceEvent[];
}

const corpusMinimums = {
  sourceEvents: 10,
  publisherFamilies: 8,
  settingFamilies: 8,
  timeBands: 4,
} as const;

export async function loadPersonalitySourceRegisterV2(
  projectRoot = process.cwd(),
): Promise<PersonalitySourceRegisterSnapshot> {
  const researchRoot = path.resolve(projectRoot, "research");
  const [v2Text, legacyText] = await Promise.all([
    readFile(path.resolve(researchRoot, "source-events-v2.yaml"), "utf8"),
    readFile(path.resolve(researchRoot, "sources.yaml"), "utf8"),
  ]);
  const register = sourceRegisterV2Schema.parse(parse(v2Text));
  const legacy = legacyRegisterSchema.parse(parse(legacyText));
  assertUnique(register.events.map((source) => source.sourceEventId), "source event ID");
  assertUnique(register.events.map((source) => source.sourceRegisterId), "source register ID");
  assertUnique(register.events.map((source) => source.eventIdentity), "event identity");
  assertUnique(register.events.map((source) => source.url), "source URL");
  assertUnique(
    register.live_fingerprint_verification.required_source_ids,
    "live fingerprint source ID",
  );
  assertUnique(register.live_fingerprint_verification.allowed_origins, "allowed content origin");
  assertUnique(register.publisher_families.map((family) => family.id), "publisher family ID");
  assertUnique(register.setting_families.map((family) => family.id), "setting family ID");
  assertUnique(
    register.setting_families.map((family) => String(family.classification_priority)),
    "setting classification priority",
  );
  assertUnique(
    register.events.flatMap((source) => source.sourceContentFingerprint ?? []),
    "source content fingerprint",
  );
  assertLegacyCoverage(register.events, legacy.sources);
  assertPublisherLineage(register.events, register.publisher_families);
  assertSettingTaxonomy(register.events, register.setting_families);
  assertLiveFingerprintPolicy(register.events, register.live_fingerprint_verification);
  const ready = register.events.filter((source) => source.accessState === "coding-ready");
  const publishers = new Set(ready.map((source) => source.publisherFamilyId));
  const settings = new Set(ready.map((source) => source.settingFamily));
  const timeBands = new Set(ready.map((source) => source.timeBand));
  return {
    schemaVersion: "jolene.personality-source-register.v2",
    registerFingerprint: digest(v2Text),
    reviewedAt: register.reviewed_at,
    registeredEvents: register.events.length,
    legacyNormalizedEvents: legacy.sources.length,
    newlyRegisteredEvents: register.events.length - legacy.sources.length,
    registeredPublisherFamilies: register.publisher_families.length,
    registeredSettingFamilies: register.setting_families.length,
    codingReadyEvents: ready.length,
    codingReadyPublisherFamilies: publishers.size,
    codingReadySettingFamilies: settings.size,
    codingReadyTimeBands: timeBands.size,
    metadataOnlyEvents: register.events.filter((source) => source.accessState === "metadata-only").length,
    unavailableEvents: register.events.filter((source) => source.accessState === "unavailable").length,
    excludedEvents: register.events.filter((source) => source.accessState === "excluded").length,
    liveFingerprintPolicy: {
      requiredSourceIds: register.live_fingerprint_verification.required_source_ids,
      allowedOrigins: register.live_fingerprint_verification.allowed_origins,
      timeoutMs: register.live_fingerprint_verification.timeout_ms,
      maximumResponseBytes: register.live_fingerprint_verification.maximum_response_bytes,
      maximumRedirects: register.live_fingerprint_verification.maximum_redirects,
    },
    gateGaps: {
      sourceEvents: gap(corpusMinimums.sourceEvents, ready.length),
      publisherFamilies: gap(corpusMinimums.publisherFamilies, publishers.size),
      settingFamilies: gap(corpusMinimums.settingFamilies, settings.size),
      timeBands: gap(corpusMinimums.timeBands, timeBands.size),
    },
    events: register.events,
  };
}

const requiredLiveSourceIds = [
  "S02", "S03", "S04", "S05", "S07", "S08", "S09", "S13", "S16", "S17", "S18",
] as const;
const requiredLiveSourceOrigins = [
  "https://freshairarchive.org",
  "https://transcripts.cnn.com",
  "https://www.press.org",
  "https://www.wfae.org",
  "https://www.wprl.org",
  "https://danratherjournalist.org",
  "https://www.loc.gov",
  "https://www.ted.com",
  "https://blankonblank.org",
  "https://www.wired.com",
  "https://cdn.imaginationlibrary.com",
] as const;
const requiredLiveSourceMethods = [
  "fresh-air-transcript-paragraphs-v1",
  "cnn-transcript-body-paragraphs-v1",
  "raw-pdf-bytes-v1",
  "npr-station-article-body-paragraphs-v1",
  "npr-station-article-body-paragraphs-v1",
  "raw-pdf-bytes-v1",
  "raw-pdf-bytes-v1",
  "ted-next-data-transcript-segments-v1",
  "blank-on-blank-transcript-paragraphs-v1",
  "wired-indexed-transcript-captions-v1",
  "raw-pdf-bytes-v1",
] as const;

function assertLiveFingerprintPolicy(
  events: readonly PersonalitySourceEvent[],
  policy: {
    readonly required_source_ids: readonly string[];
    readonly allowed_origins: readonly string[];
  },
) {
  if (policy.required_source_ids.length !== requiredLiveSourceIds.length ||
      requiredLiveSourceIds.some((id) => !policy.required_source_ids.includes(id))) {
    throw new Error("Live fingerprint policy must require every coding-ready source exactly");
  }
  if (policy.allowed_origins.length !== requiredLiveSourceOrigins.length ||
      requiredLiveSourceOrigins.some((origin) => !policy.allowed_origins.includes(origin))) {
    throw new Error("Live fingerprint policy must allow only coding-ready content origins");
  }
  for (const origin of policy.allowed_origins) {
    const parsed = new URL(origin);
    if (parsed.protocol !== "https:" || parsed.origin !== origin) {
      throw new Error(`Allowed content origin must be an exact HTTPS origin: ${origin}`);
    }
  }
  const codingReadyIds = events.filter((source) => source.accessState === "coding-ready")
    .map((source) => source.sourceRegisterId);
  if (codingReadyIds.length !== policy.required_source_ids.length ||
      codingReadyIds.some((id) => !policy.required_source_ids.includes(id))) {
    throw new Error("Live fingerprint policy and coding-ready source set disagree");
  }
  const byId = new Map(events.map((source) => [source.sourceRegisterId, source]));
  for (const id of policy.required_source_ids) {
    const source = byId.get(id);
    if (!source?.contentBoundaryUrl ||
        new URL(source.contentBoundaryUrl).origin !== originForSource(id)) {
      throw new Error(`${id} must use its registered content origin`);
    }
    if (source.fingerprintMethod !== methodForSource(id)) {
      throw new Error(`${id} must use its registered canonical fingerprint method`);
    }
  }
}

function originForSource(sourceId: string): string {
  const index = requiredLiveSourceIds.indexOf(sourceId as typeof requiredLiveSourceIds[number]);
  if (index < 0) throw new Error(`Unexpected live fingerprint source ${sourceId}`);
  return requiredLiveSourceOrigins[index] ?? "";
}

function methodForSource(sourceId: string): string {
  const index = requiredLiveSourceIds.indexOf(sourceId as typeof requiredLiveSourceIds[number]);
  if (index < 0) throw new Error(`Unexpected live fingerprint source ${sourceId}`);
  return requiredLiveSourceMethods[index] ?? "";
}

function assertSettingTaxonomy(
  events: readonly PersonalitySourceEvent[],
  families: readonly { readonly id: z.infer<typeof settingFamilySchema> }[],
) {
  const registered = new Set(families.map((family) => family.id));
  const expected = new Set(settingFamilySchema.options);
  if (registered.size !== expected.size || [...expected].some((id) => !registered.has(id))) {
    throw new Error("Setting taxonomy must define every controlled setting family exactly once");
  }
  for (const source of events) {
    if (!registered.has(source.settingFamily)) {
      throw new Error(`Unknown setting family ${source.settingFamily}`);
    }
  }
}

function assertPublisherLineage(
  events: readonly PersonalitySourceEvent[],
  families: readonly {
    readonly id: string;
    readonly distribution_hosts: readonly string[];
  }[],
) {
  const registered = new Map(families.map((family) => [family.id, family]));
  for (const source of events) {
    const family = registered.get(source.publisherFamilyId);
    if (!family) throw new Error(`Unknown publisher family ${source.publisherFamilyId}`);
    if (!family.distribution_hosts.includes(source.distributionHost)) {
      throw new Error(
        `Distribution host ${source.distributionHost} is not registered for ${source.publisherFamilyId}`,
      );
    }
  }
}

export function timeBandForDate(date: string): z.infer<typeof timeBandSchema> {
  const year = Number.parseInt(date.slice(0, 4), 10);
  if (year < 2000) return "pre-2000";
  if (year < 2010) return "2000s";
  if (year < 2020) return "2010s";
  return "2020s";
}

function assertLegacyCoverage(
  events: readonly PersonalitySourceEvent[],
  legacySources: readonly { readonly id: string; readonly url: string }[],
) {
  const normalized = new Map(events.map((source) => [source.sourceRegisterId, source.url]));
  if (events.length < legacySources.length) {
    throw new Error("V2 source register cannot contain fewer events than the legacy register");
  }
  for (const source of legacySources) {
    if (normalized.get(source.id) !== source.url) {
      throw new Error(`V2 source register does not preserve ${source.id}`);
    }
  }
}

function assertUnique(values: readonly string[], label: string) {
  if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label}`);
}

function gap(minimum: number, actual: number) {
  return Math.max(0, minimum - actual);
}

function digest(value: string) {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}
