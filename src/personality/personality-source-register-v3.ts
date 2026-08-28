import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { parse } from "yaml";
import { z } from "zod";

import { loadPersonalityAvRecoveryOutcomeV1 } from "./personality-av-recovery-outcome.js";
import { loadPersonalitySamplingBoundaryProtocolV1 } from
  "./personality-sampling-boundary-protocol.js";
import {
  loadPersonalitySourceRegisterV2,
  personalitySourceEventSchema,
} from "./personality-source-register.js";

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const sourceIdSchema = z.string().regex(/^S\d{2}$/);
const repairSchema = z.object({
  schema_version: z.literal("personality-source-register-repair-v3"),
  status: z.literal("prospective-repaired-non-activating"),
  reviewed_at: z.string().datetime(),
  base_register: z.object({
    schema_version: z.literal("jolene.personality-source-register.v2"),
    fingerprint: sha256Schema,
  }).strict(),
  boundary_protocol_fingerprint: sha256Schema,
  av_recovery_status: z.literal("failed-before-map-creation"),
  av_recovery_outcome_fingerprint: sha256Schema,
  access_repairs: z.array(z.object({
    source_register_id: z.enum(["S07", "S16", "S17"]),
    source_event_id: z.enum(["E006", "E012", "E013"]),
    from: z.literal("coding-ready"),
    to: z.literal("excluded"),
    reason: z.string().min(40),
  }).strict()).length(3),
  publisher_family_additions: z.array(z.object({
    id: z.enum(["interview-magazine", "vanity-fair"]),
    label: z.string().min(1),
    distribution_hosts: z.array(z.string().min(1)).length(1),
    independence_note: z.string().min(40),
  }).strict()).length(2),
  event_additions: z.array(personalitySourceEventSchema).length(2),
  live_fingerprint_verification: z.object({
    required_source_ids: z.array(sourceIdSchema).length(10),
    allowed_origins: z.array(z.string().url()).length(10),
    fingerprint_methods: z.array(z.string().min(1)).length(10),
  }).strict(),
  rights: z.object({
    repository_storage: z.literal("metadata-and-paraphrase-only"),
    transcript_storage: z.literal("prohibited"), lyrics_storage: z.literal("prohibited"),
    audio_video_storage: z.literal("prohibited"),
    content_fingerprint_storage: z.literal("sha256-only"),
  }).strict(),
  runtime_activation: z.literal("prohibited"),
}).strict();

const minimums = { events: 10, publishers: 8, settings: 8, timeBands: 4 } as const;

export async function loadPersonalitySourceRegisterV3(projectRoot = process.cwd()) {
  const repairText = await readFile(path.resolve(
    projectRoot, "research", "source-register-v3-repair.yaml",
  ), "utf8");
  const repair = repairSchema.parse(parse(repairText));
  const [base, protocol, avOutcome] = await Promise.all([
    loadPersonalitySourceRegisterV2(projectRoot),
    loadPersonalitySamplingBoundaryProtocolV1(projectRoot),
    loadPersonalityAvRecoveryOutcomeV1(projectRoot),
  ]);
  if (repair.base_register.fingerprint !== base.registerFingerprint ||
      repair.boundary_protocol_fingerprint !== protocol.protocolFingerprint ||
      repair.av_recovery_status !== avOutcome.status ||
      repair.av_recovery_outcome_fingerprint !== avOutcome.outcomeFingerprint) {
    throw new Error("Source-register v3 repair prerequisites are stale");
  }
  if (Date.parse(repair.reviewed_at) < Math.max(
    Date.parse(base.reviewedAt), Date.parse(protocol.createdAt), Date.parse(avOutcome.evaluatedAt),
  )) {
    throw new Error("Source-register v3 repair predates its prerequisites");
  }
  assertUnique(repair.access_repairs.map((item) => item.source_register_id), "repair source ID");
  assertUnique(repair.publisher_family_additions.map((item) => item.id), "publisher family ID");
  const repairById = new Map<string, typeof repair.access_repairs[number]>(
    repair.access_repairs.map((item) => [item.source_register_id, item]),
  );
  const repairedBase = base.events.map((source) => {
    const accessRepair = repairById.get(source.sourceRegisterId);
    if (!accessRepair) return source;
    if (source.sourceEventId !== accessRepair.source_event_id ||
        source.accessState !== accessRepair.from) {
      throw new Error(`Source access repair mismatch for ${source.sourceRegisterId}`);
    }
    return { ...source, accessState: accessRepair.to, accessReason: accessRepair.reason };
  });
  const events = [...repairedBase, ...repair.event_additions];
  const additionsById = new Map(
    repair.event_additions.map((source) => [source.sourceRegisterId, source]),
  );
  if (additionsById.get("S19")?.sourceEventId !== "E015" ||
      additionsById.get("S20")?.sourceEventId !== "E016" || additionsById.size !== 2) {
    throw new Error("Source-register v3 replacements must be S19/E015 and S20/E016");
  }
  assertUnique(events.map((source) => source.sourceRegisterId), "source register ID");
  assertUnique(events.map((source) => source.sourceEventId), "source event ID");
  assertUnique(events.map((source) => source.eventIdentity), "source event identity");
  assertUnique(events.flatMap((source) => source.sourceContentFingerprint ?? []),
    "source content fingerprint");
  for (const addition of repair.event_additions) {
    if (base.events.some((source) => source.publisherFamilyId === addition.publisherFamilyId)) {
      throw new Error(`Replacement publisher family is not new for ${addition.sourceRegisterId}`);
    }
    const family = repair.publisher_family_additions.find(
      (candidate) => candidate.id === addition.publisherFamilyId,
    );
    if (!family || !family.distribution_hosts.includes(addition.distributionHost)) {
      throw new Error(`New source publisher lineage mismatch for ${addition.sourceRegisterId}`);
    }
  }
  const ready = events.filter((source) => source.accessState === "coding-ready");
  assertLivePolicy(ready, repair.live_fingerprint_verification);
  const publishers = new Set(ready.map((source) => source.publisherFamilyId));
  const settings = new Set(ready.map((source) => source.settingFamily));
  const timeBands = new Set(ready.map((source) => source.timeBand));
  return {
    schemaVersion: "jolene.personality-source-register.v3" as const,
    registerFingerprint: digest(repairText),
    baseRegisterFingerprint: repair.base_register.fingerprint,
    boundaryProtocolFingerprint: repair.boundary_protocol_fingerprint,
    reviewedAt: repair.reviewed_at,
    registeredEvents: events.length,
    registeredPublisherFamilies:
      base.registeredPublisherFamilies + repair.publisher_family_additions.length,
    codingReadyEvents: ready.length,
    codingReadyPublisherFamilies: publishers.size,
    codingReadySettingFamilies: settings.size,
    codingReadyTimeBands: timeBands.size,
    excludedEvents: events.filter((source) => source.accessState === "excluded").length,
    zeroAttributionSourcesDowngraded: repair.access_repairs.map(
      (source) => source.source_register_id,
    ),
    replacementSources: repair.event_additions.map((source) => source.sourceRegisterId),
    liveFingerprintPolicy: {
      requiredSourceIds: repair.live_fingerprint_verification.required_source_ids,
      allowedOrigins: repair.live_fingerprint_verification.allowed_origins,
      timeoutMs: base.liveFingerprintPolicy.timeoutMs,
      maximumResponseBytes: base.liveFingerprintPolicy.maximumResponseBytes,
      maximumRedirects: base.liveFingerprintPolicy.maximumRedirects,
    },
    gateGaps: {
      sourceEvents: gap(minimums.events, ready.length),
      publisherFamilies: gap(minimums.publishers, publishers.size),
      settingFamilies: gap(minimums.settings, settings.size),
      timeBands: gap(minimums.timeBands, timeBands.size),
    },
    runtimeActivation: repair.runtime_activation,
    events,
  };
}

function assertLivePolicy(
  ready: readonly z.infer<typeof personalitySourceEventSchema>[],
  policy: z.infer<typeof repairSchema>["live_fingerprint_verification"],
) {
  assertUnique(policy.required_source_ids, "live-policy source ID");
  assertUnique(policy.allowed_origins, "live-policy origin");
  if (ready.length !== policy.required_source_ids.length) {
    throw new Error("Source-register v3 live policy does not cover the ready set");
  }
  for (const source of ready) {
    const index = policy.required_source_ids.indexOf(source.sourceRegisterId);
    if (index < 0 || !source.contentBoundaryUrl ||
        policy.allowed_origins[index] !== new URL(source.contentBoundaryUrl).origin ||
        policy.fingerprint_methods[index] !== source.fingerprintMethod) {
      throw new Error(`Source-register v3 live policy mismatch for ${source.sourceRegisterId}`);
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
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
