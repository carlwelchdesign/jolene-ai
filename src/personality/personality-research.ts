import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { parse } from "yaml";
import { z } from "zod";

const sourceSchema = z.object({
  id: z.string().regex(/^S\d{2}$/),
  date: z.union([z.number().int(), z.string().min(4)]),
  title: z.string().min(1),
  publisher: z.string().min(1),
  url: z.string().url(),
  setting: z.string().min(1),
  access_state: z.string().min(1),
  rights_handling: z.string().min(1),
  research_value: z.string().min(1),
  weight: z.string().min(1),
});

const sourceRegisterSchema = z.object({
  schema_version: z.literal("personality-source-register-v1"),
  reviewed_at: z.string(),
  rights_policy: z.object({
    repository_storage: z.literal("metadata-and-paraphrase-only"),
    transcript_storage: z.literal("prohibited"),
    lyrics_storage: z.literal("prohibited"),
    excerpt_limit_words: z.number().int().max(24),
  }),
  sources: z.array(sourceSchema).min(10),
});

const observationSchema = z.object({
  observation_id: z.string().regex(/^P\d{3}$/),
  source_id: z.string().regex(/^S\d{2}$/),
  source_url: z.string().url(),
  date: z.string().min(4),
  setting: z.string().min(1),
  topic: z.string().min(1),
  timestamp_or_page: z.string().min(1),
  excerpt_under_25_words: z.null(),
  paraphrase: z.string().min(20),
  speech_act: z.enum([
    "acknowledge", "answer", "joke", "reframe", "boundary", "story",
    "advise", "credit", "ask",
  ]),
  emotional_function: z.string().min(1),
  humor_target: z.enum(["self", "situation", "institution", "none", "other"]),
  observable_language_pattern: z.string().min(1),
  observable_nonverbal_pattern: z.null(),
  seriousness_pivot: z.boolean(),
  uncertainty_or_expertise_boundary: z.string().min(1).nullable(),
  action_offered: z.string().min(1).nullable(),
  credit_given: z.string().min(1).nullable(),
  candidate_trait: z.string().min(1),
  observation_evidence_class: z.literal("observed"),
  candidate_trait_evidence_class: z.enum(["inferred", "rejected"]),
  adaptation_evidence_class: z.enum(["designed", "rejected"]),
  observation_confidence: z.enum(["low", "medium", "high"]),
  trait_confidence: z.enum(["low", "medium", "high"]),
  alternative_interpretation: z.string().min(1),
  professional_context_suitability: z.array(z.string().min(1)).min(1),
  jolene_adaptation: z.string().min(1),
  do_not_copy: z.string().min(1),
  reviewer: z.string().min(1),
  review_status: z.enum([
    "pilot-coded", "second-review-agree", "second-review-adjusted", "rejected",
  ]),
});

const codingSchemaSchema = z.object({
  schema_version: z.literal("personality-observation-v1"),
  required_fields: z.array(z.string()).min(20),
  constraints: z.object({
    excerpt_max_words: z.number().int().max(24),
    excerpts_must_be_null_for_pilot: z.literal(true),
    lyrics_prohibited: z.literal(true),
    paraphrase_required: z.literal(true),
    source_id_must_exist_in_register: z.literal(true),
    minimum_pilot_segments: z.number().int().min(25),
    minimum_pilot_sources: z.number().int().min(5),
    minimum_pilot_contexts: z.number().int().min(5),
    minimum_second_review_rate: z.number().min(0.25).max(1),
    evidence_class_separation_required: z.literal(true),
  }),
});

const artifactFiles = [
  "sources.yaml",
  "coding-schema.yaml",
  "observations.jsonl",
  "pilot-character-hypotheses.md",
  "rejection-log.md",
] as const;

export interface PersonalityResearchSummary {
  readonly registeredSources: number;
  readonly observations: number;
  readonly codedSources: number;
  readonly codedContexts: number;
  readonly evidenceClasses: readonly string[];
  readonly independentlyReviewed: number;
}

export interface PersonalityResearchSnapshot extends PersonalityResearchSummary {
  readonly schemaVersion: "jolene.personality-research-snapshot.v1";
  readonly snapshotHash: string;
  readonly reviewedAt: string;
  readonly rightsPolicy: {
    readonly repositoryStorage: "metadata-and-paraphrase-only";
    readonly transcriptStorage: "prohibited";
    readonly lyricsStorage: "prohibited";
  };
  readonly artifacts: readonly {
    readonly name: typeof artifactFiles[number];
    readonly sha256: string;
    readonly byteLength: number;
  }[];
  readonly sources: readonly z.infer<typeof sourceSchema>[];
  readonly codedObservations: readonly z.infer<typeof observationSchema>[];
  readonly hypothesesMarkdown: string;
  readonly rejectionLogMarkdown: string;
}

export async function loadPersonalityResearch(
  projectRoot = process.cwd(),
): Promise<PersonalityResearchSnapshot> {
  const researchRoot = path.resolve(projectRoot, "research");
  const texts = await Promise.all(
    artifactFiles.map((name) => readFile(path.resolve(researchRoot, name), "utf8")),
  );
  const byName = new Map(artifactFiles.map((name, index) => [name, texts[index]!]));
  const register = sourceRegisterSchema.parse(parse(byName.get("sources.yaml")!));
  const codingSchema = codingSchemaSchema.parse(parse(byName.get("coding-schema.yaml")!));
  const observations = byName.get("observations.jsonl")!
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line, index) => {
      try {
        return observationSchema.parse(JSON.parse(line));
      } catch (error) {
        throw new Error(`Invalid observation on line ${index + 1}`, { cause: error });
      }
    });

  const sourceById = new Map(register.sources.map((source) => [source.id, source]));
  const ids = new Set<string>();
  for (const observation of observations) {
    if (ids.has(observation.observation_id)) {
      throw new Error(`Duplicate observation ID: ${observation.observation_id}`);
    }
    ids.add(observation.observation_id);
    const source = sourceById.get(observation.source_id);
    if (!source) throw new Error(`Unknown source ID: ${observation.source_id}`);
    if (source.url !== observation.source_url) {
      throw new Error(`Source URL mismatch for ${observation.observation_id}`);
    }
  }

  const codedSources = new Set(observations.map((item) => item.source_id));
  const codedContexts = new Set(
    observations.flatMap((item) => item.professional_context_suitability),
  );
  assertMinimums(observations, codedSources, codedContexts, codingSchema.constraints);
  const independentlyReviewed = observations.filter((item) =>
    item.review_status.startsWith("second-review")
  ).length;
  const minimumIndependentReviews = Math.ceil(
    observations.length * codingSchema.constraints.minimum_second_review_rate,
  );
  if (independentlyReviewed < minimumIndependentReviews) {
    throw new Error(
      `Personality pilot needs at least ${minimumIndependentReviews} independent reviews`,
    );
  }

  const artifacts = artifactFiles.map((name, index) => ({
    name,
    sha256: digest(texts[index]!),
    byteLength: Buffer.byteLength(texts[index]!, "utf8"),
  }));
  const snapshotHash = digest(
    artifacts.map((item) => `${item.name}:${item.sha256}`).join("\n"),
  );
  return {
    schemaVersion: "jolene.personality-research-snapshot.v1",
    snapshotHash,
    reviewedAt: register.reviewed_at,
    rightsPolicy: {
      repositoryStorage: register.rights_policy.repository_storage,
      transcriptStorage: register.rights_policy.transcript_storage,
      lyricsStorage: register.rights_policy.lyrics_storage,
    },
    artifacts,
    registeredSources: register.sources.length,
    observations: observations.length,
    codedSources: codedSources.size,
    codedContexts: codedContexts.size,
    evidenceClasses: [
      ...new Set(observations.flatMap((item) => [
        item.observation_evidence_class,
        item.candidate_trait_evidence_class,
        item.adaptation_evidence_class,
      ])),
    ],
    independentlyReviewed,
    sources: register.sources,
    codedObservations: observations,
    hypothesesMarkdown: byName.get("pilot-character-hypotheses.md")!,
    rejectionLogMarkdown: byName.get("rejection-log.md")!,
  };
}

function assertMinimums(
  observations: readonly z.infer<typeof observationSchema>[],
  codedSources: ReadonlySet<string>,
  codedContexts: ReadonlySet<string>,
  constraints: z.infer<typeof codingSchemaSchema>["constraints"],
) {
  if (observations.length < constraints.minimum_pilot_segments) {
    throw new Error("Personality pilot has too few observations");
  }
  if (codedSources.size < constraints.minimum_pilot_sources) {
    throw new Error("Personality pilot has too few independently published sources");
  }
  if (codedContexts.size < constraints.minimum_pilot_contexts) {
    throw new Error("Personality pilot has too few professional contexts");
  }
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
