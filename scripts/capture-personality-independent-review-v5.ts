import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import OpenAI from "openai";
import { z } from "zod";

import { loadConfig } from "../src/config.js";
import type { PersonalityPrimaryCodingInput } from
  "../src/personality/openai-personality-primary-coder.js";
import {
  OpenAIPersonalityIndependentReviewer,
  type IndependentPersonalityAssignment,
  type PersonalityAdjudicationDecision,
} from "../src/personality/openai-personality-independent-reviewer.js";
import {
  buildPersonalityIndependentReviewV5,
  categoricalCodingFromTurn,
  changedCategoricalFields,
  independentAssignmentFingerprint,
  independentReviewReasons,
  validatePersonalityIndependentReviewV5,
  type PersonalityCategoricalCodingV5,
} from "../src/personality/personality-independent-review-v5.js";
import { personalityPrimaryCodingArtifactV5Schema } from
  "../src/personality/personality-primary-coding-v5.js";
import { loadPersonalitySelectionArtifactsV5 } from
  "../src/personality/personality-selection-ledgers-v5.js";
import { extractSelectedHtmlPersonalitySourceTexts } from
  "../src/personality/personality-selected-html-source-text.js";
import { extractSelectedPdfPersonalitySourceTexts } from
  "../src/personality/personality-selected-pdf-source-text.js";

export interface IndependentReviewCaptureDependencies {
  readonly modelVersion: string;
  readonly reviewBatch: (
    input: readonly PersonalityPrimaryCodingInput[],
  ) => Promise<readonly IndependentPersonalityAssignment[]>;
  readonly adjudicateBatch: (
    input: readonly (PersonalityPrimaryCodingInput & {
      readonly primaryCoding: PersonalityCategoricalCodingV5;
      readonly independentCoding: PersonalityCategoricalCodingV5;
    })[],
  ) => Promise<readonly PersonalityAdjudicationDecision[]>;
  readonly now?: () => Date;
  readonly htmlSourceTexts?: typeof extractSelectedHtmlPersonalitySourceTexts;
  readonly pdfSourceTexts?: typeof extractSelectedPdfPersonalitySourceTexts;
}

const checkpointCodingSchema = z.object({
  speechAct: z.enum([
    "acknowledge", "advise", "answer", "ask", "boundary", "credit", "joke",
    "reframe", "story",
  ]),
  researchContext: z.enum([
    "attribution", "boundaries", "care", "humor", "leadership", "recovery",
    "uncertainty", "work-practice",
  ]),
  traitFamilyId: z.enum([
    "bounded-warmth", "calibrated-wit", "candid-repair", "credit-aware-authority",
    "disciplined-agency", "grounded-optimism", "operational-care", "uncertainty-humility",
  ]),
  seriousnessPivot: z.boolean(),
}).strict();
const checkpointSchema = z.object({
  schemaVersion: z.literal("jolene.personality-independent-review-checkpoint.v1"),
  primaryCodingFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  selectionManifestFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  modelVersion: z.string().min(1),
  assignments: z.array(z.object({
    selectionId: z.string(),
    coding: checkpointCodingSchema,
    assignedAt: z.string().datetime(),
    codedAt: z.string().datetime(),
  }).strict()),
  decisions: z.array(z.object({
    selectionId: z.string(),
    reconciledCoding: checkpointCodingSchema,
    rationale: z.string().min(20).max(500),
  }).strict()),
}).strict();

export async function capturePersonalityIndependentReviewV5(
  dependencies: IndependentReviewCaptureDependencies,
  projectRoot = process.cwd(),
) {
  const [primaryText, selection, html, pdf] = await Promise.all([
    readFile(path.resolve(projectRoot, "research/primary-coding-v5.json"), "utf8"),
    loadPersonalitySelectionArtifactsV5(projectRoot),
    (dependencies.htmlSourceTexts ?? extractSelectedHtmlPersonalitySourceTexts)(projectRoot),
    (dependencies.pdfSourceTexts ?? extractSelectedPdfPersonalitySourceTexts)(projectRoot),
  ]);
  const primary = personalityPrimaryCodingArtifactV5Schema.parse(JSON.parse(primaryText));
  const primaryCodingFingerprint = digest(primaryText);
  const transientBySelectionId = new Map(
    [...html, ...pdf].map((item) => [item.selectionId, item]),
  );
  const selected = selection.ledgers.flatMap((ledger) => ledger.selectedUnits.map((unit) => ({
    ledger, unit,
  })));
  const required = primary.turns.map((turn, index) => {
    const frozen = selected[index];
    const transient = frozen ? transientBySelectionId.get(frozen.unit.selectionId) : undefined;
    if (!frozen || !transient || transient.segmentFingerprint !== turn.segmentFingerprint) {
      throw new Error(`Independent review source alignment failed for ${turn.observationId}`);
    }
    const reasons = independentReviewReasons(turn);
    const input: PersonalityPrimaryCodingInput = {
      selectionId: transient.selectionId,
      sourceRegisterId: transient.sourceRegisterId,
      sourceEventId: transient.sourceEventId,
      locatorLabel: transient.locatorLabel,
      selectionRuleId: transient.selectionRuleId,
      agreedHighRiskStrata: transient.agreedHighRiskStrata,
      sourceText: transient.sourceText,
    };
    return { turn, reasons, input };
  }).filter((item) => item.reasons.length > 0);

  const clock = dependencies.now ?? (() => new Date());
  const independentReviewer = {
    reviewerId: "jolene-independent-reviewer-v5",
    reviewerType: "ai" as const,
    tool: "OpenAI Responses API blinded categorical review; store=false",
    modelVersion: dependencies.modelVersion,
  };
  const adjudicator = {
    reviewerId: "jolene-reconciliation-adjudicator-v5",
    reviewerType: "ai" as const,
    tool: "OpenAI Responses API disagreement adjudication; store=false",
    modelVersion: dependencies.modelVersion,
  };
  const checkpointPath = path.resolve(
    projectRoot, ".jolene/checkpoints/personality-independent-review-v5.json",
  );
  const checkpoint = await loadCheckpoint(checkpointPath, {
    primaryCodingFingerprint,
    selectionManifestFingerprint: selection.manifestFingerprint,
    modelVersion: dependencies.modelVersion,
  });
  const rawBySelectionId = new Map<string, {
    readonly assignment: IndependentPersonalityAssignment;
    readonly assignedAt: string;
    readonly codedAt: string;
  }>(checkpoint.assignments.map((item) => [item.selectionId, {
    assignment: { selectionId: item.selectionId, coding: item.coding },
    assignedAt: item.assignedAt,
    codedAt: item.codedAt,
  }]));
  for (const batch of chunks(required, 20)) {
    const pending = batch.filter((item) => !rawBySelectionId.has(item.input.selectionId));
    if (pending.length === 0) continue;
    const assignedAt = clock().toISOString();
    const assignments = await dependencies.reviewBatch(pending.map((item) => item.input));
    const codedAt = clock().toISOString();
    assignments.forEach((assignment) => rawBySelectionId.set(assignment.selectionId, {
      assignment, assignedAt, codedAt,
    }));
    checkpoint.assignments = [...rawBySelectionId.values()].map((item) => ({
      selectionId: item.assignment.selectionId,
      coding: item.assignment.coding,
      assignedAt: item.assignedAt,
      codedAt: item.codedAt,
    }));
    await writeCheckpoint(checkpointPath, checkpoint);
  }
  if (rawBySelectionId.size !== required.length) {
    throw new Error("Independent reviewer did not return the complete frozen review set");
  }

  const disagreements = required.flatMap((item) => {
    const raw = rawBySelectionId.get(item.input.selectionId)?.assignment.coding;
    if (!raw) throw new Error(`Missing independent assignment for ${item.input.selectionId}`);
    const primaryCoding = categoricalCodingFromTurn(item.turn);
    return changedCategoricalFields(primaryCoding, raw).length === 0 ? [] : [{
      ...item.input,
      primaryCoding,
      independentCoding: raw,
    }];
  });
  const decisionBySelectionId = new Map<string, PersonalityAdjudicationDecision>(
    checkpoint.decisions.map((item) => [item.selectionId, item]),
  );
  for (const batch of chunks(disagreements, 20)) {
    const pending = batch.filter((item) => !decisionBySelectionId.has(item.selectionId));
    if (pending.length === 0) continue;
    const decisions = await dependencies.adjudicateBatch(pending);
    decisions.forEach((decision) => decisionBySelectionId.set(decision.selectionId, decision));
    checkpoint.decisions = [...decisionBySelectionId.values()];
    await writeCheckpoint(checkpointPath, checkpoint);
  }
  if (decisionBySelectionId.size !== disagreements.length) {
    throw new Error("Adjudicator did not return every categorical disagreement");
  }

  const reviews = required.map((item) => {
    const captured = rawBySelectionId.get(item.input.selectionId)!;
    const primaryCoding = categoricalCodingFromTurn(item.turn);
    const rawCoding = captured.assignment.coding;
    const changedFields = changedCategoricalFields(primaryCoding, rawCoding);
    const decision = decisionBySelectionId.get(item.input.selectionId);
    const reconciledAt = clock().toISOString();
    return {
      observationId: item.turn.observationId,
      selectionId: item.input.selectionId,
      sourceEventId: item.turn.sourceEventId,
      reviewReasons: [...item.reasons],
      assignedAt: captured.assignedAt,
      codedAt: captured.codedAt,
      reconciledAt,
      independentAssignmentFingerprint: independentAssignmentFingerprint({
        observationId: item.turn.observationId,
        selectionId: item.input.selectionId,
        reviewer: independentReviewer,
        rawCoding,
      }),
      primaryRawCoding: primaryCoding,
      rawCoding,
      reconciledCoding: decision?.reconciledCoding ?? rawCoding,
      disposition: changedFields.length === 0 ? "agree" as const : "adjusted" as const,
      changedFields,
      adjudicationRationale: decision?.rationale ??
        "The blinded independent assignment matches the primary categorical coding.",
    };
  });
  const artifact = buildPersonalityIndependentReviewV5({
    reviewedAt: clock().toISOString(),
    primaryCodingFingerprint,
    selectionManifestFingerprint: selection.manifestFingerprint,
    independentReviewer,
    adjudicator,
    reviews,
    primary,
  });
  const validation = await validatePersonalityIndependentReviewV5(artifact, projectRoot);
  return { artifact, validation, checkpointPath };
}

export async function writePersonalityIndependentReviewV5(
  artifact: Awaited<ReturnType<typeof capturePersonalityIndependentReviewV5>>["artifact"],
  projectRoot = process.cwd(),
) {
  const target = path.resolve(projectRoot, "research/independent-review-v5.json");
  const staging = `${target}.staging-${process.pid}`;
  await mkdir(path.dirname(target), { recursive: true });
  try {
    await writeFile(staging, `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o600 });
    await chmod(staging, 0o600);
    await rename(staging, target);
  } catch (error) {
    await rm(staging, { force: true });
    throw error;
  }
  return target;
}

async function main() {
  const config = loadConfig();
  const reviewer = new OpenAIPersonalityIndependentReviewer({
    client: new OpenAI({ apiKey: config.openaiApiKey }),
    model: config.model,
    timeoutMilliseconds: 120_000,
    maxOutputTokens: 12_000,
  });
  const { artifact, validation } = await capturePersonalityIndependentReviewV5({
    modelVersion: config.model,
    reviewBatch: (input) => reviewer.reviewBatch(input),
    adjudicateBatch: (input) => reviewer.adjudicateBatch(input),
  });
  const artifactPath = await writePersonalityIndependentReviewV5(artifact);
  await rm(path.resolve(
    process.cwd(), ".jolene/checkpoints/personality-independent-review-v5.json",
  ), { force: true });
  process.stdout.write(`${JSON.stringify({
    artifactPath,
    model: config.model,
    ...validation,
    sourceContentStored: false,
    traitAdmission: "prohibited",
    runtimeActivation: "prohibited",
  }, null, 2)}\n`);
}

function chunks<T>(values: readonly T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function loadCheckpoint(
  checkpointPath: string,
  expected: {
    readonly primaryCodingFingerprint: `sha256:${string}`;
    readonly selectionManifestFingerprint: string;
    readonly modelVersion: string;
  },
) {
  let raw: string;
  try {
    raw = await readFile(checkpointPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return {
      schemaVersion: "jolene.personality-independent-review-checkpoint.v1" as const,
      ...expected,
      assignments: [] as z.infer<typeof checkpointSchema>["assignments"],
      decisions: [] as z.infer<typeof checkpointSchema>["decisions"],
    };
  }
  const checkpoint = checkpointSchema.parse(JSON.parse(raw));
  if (checkpoint.primaryCodingFingerprint !== expected.primaryCodingFingerprint ||
      checkpoint.selectionManifestFingerprint !== expected.selectionManifestFingerprint ||
      checkpoint.modelVersion !== expected.modelVersion) {
    throw new Error("Independent-review checkpoint does not match current prerequisites");
  }
  return checkpoint;
}

async function writeCheckpoint(
  checkpointPath: string,
  checkpoint: z.infer<typeof checkpointSchema>,
) {
  const staging = `${checkpointPath}.staging-${process.pid}`;
  await mkdir(path.dirname(checkpointPath), { recursive: true, mode: 0o700 });
  try {
    await writeFile(staging, `${JSON.stringify(checkpoint, null, 2)}\n`, { mode: 0o600 });
    await chmod(staging, 0o600);
    await rename(staging, checkpointPath);
  } catch (error) {
    await rm(staging, { force: true });
    throw error;
  }
}

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
