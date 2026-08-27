import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { parse } from "yaml";
import { z } from "zod";

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

export const timeBandSchema = z.enum(["pre-2000", "2000s", "2010s", "2020s"]);
export const settingFamilySchema = z.enum([
  "adversarial-interview", "archival-interview", "first-person-statement",
  "formal-qa", "long-form-audio", "long-form-video", "public-service",
  "workplace-interview",
]);

export const personalitySourceEventSchema = z.object({
  sourceEventId: z.string().regex(/^E\d{3}$/),
  sourceRegisterId: z.string().regex(/^S\d{2}$/),
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
    "official-archive-transcript", "publisher-transcript",
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
  fingerprintBasis: z.enum(["none", "official-caption-bytes", "retrieved-response-bytes"]),
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
  publisher_families: z.array(z.object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{2,63}$/),
    label: z.string().min(1),
    distribution_hosts: z.array(z.string().min(1)).min(1),
    independence_note: z.string().min(20),
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
  readonly registeredPublisherFamilies: number;
  readonly codingReadyEvents: number;
  readonly codingReadyPublisherFamilies: number;
  readonly codingReadySettingFamilies: number;
  readonly codingReadyTimeBands: number;
  readonly metadataOnlyEvents: number;
  readonly unavailableEvents: number;
  readonly excludedEvents: number;
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
  assertUnique(register.publisher_families.map((family) => family.id), "publisher family ID");
  assertUnique(
    register.events.flatMap((source) => source.sourceContentFingerprint ?? []),
    "source content fingerprint",
  );
  assertLegacyCoverage(register.events, legacy.sources);
  assertPublisherLineage(register.events, register.publisher_families);
  const ready = register.events.filter((source) => source.accessState === "coding-ready");
  const publishers = new Set(ready.map((source) => source.publisherFamilyId));
  const settings = new Set(ready.map((source) => source.settingFamily));
  const timeBands = new Set(ready.map((source) => source.timeBand));
  return {
    schemaVersion: "jolene.personality-source-register.v2",
    registerFingerprint: digest(v2Text),
    reviewedAt: register.reviewed_at,
    registeredEvents: register.events.length,
    registeredPublisherFamilies: register.publisher_families.length,
    codingReadyEvents: ready.length,
    codingReadyPublisherFamilies: publishers.size,
    codingReadySettingFamilies: settings.size,
    codingReadyTimeBands: timeBands.size,
    metadataOnlyEvents: register.events.filter((source) => source.accessState === "metadata-only").length,
    unavailableEvents: register.events.filter((source) => source.accessState === "unavailable").length,
    excludedEvents: register.events.filter((source) => source.accessState === "excluded").length,
    gateGaps: {
      sourceEvents: gap(corpusMinimums.sourceEvents, ready.length),
      publisherFamilies: gap(corpusMinimums.publisherFamilies, publishers.size),
      settingFamilies: gap(corpusMinimums.settingFamilies, settings.size),
      timeBands: gap(corpusMinimums.timeBands, timeBands.size),
    },
    events: register.events,
  };
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
  if (events.length !== legacySources.length) {
    throw new Error("V2 source register must normalize every legacy source exactly once");
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
