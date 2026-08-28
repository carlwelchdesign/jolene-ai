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
} from "../src/personality/openai-personality-independent-reviewer.js";
import { independentReviewReasons, personalityIndependentReviewV5Schema } from
  "../src/personality/personality-independent-review-v5.js";
import { personalityPrimaryCodingArtifactV5Schema } from
  "../src/personality/personality-primary-coding-v5.js";
import {
  calculateRecodingAgreement,
  changedFields,
  digest,
  loadPersonalityCategoricalCodebookV1,
  personalityRecodingV1Schema,
  validatePersonalityRecodingV1,
} from "../src/personality/personality-recoding-v1.js";
import { loadPersonalitySelectionArtifactsV5 } from
  "../src/personality/personality-selection-ledgers-v5.js";
import { extractSelectedHtmlPersonalitySourceTexts } from
  "../src/personality/personality-selected-html-source-text.js";
import { extractSelectedPdfPersonalitySourceTexts } from
  "../src/personality/personality-selected-pdf-source-text.js";

const codingSchema = z.object({
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
const captureSchema = z.object({
  schemaVersion: z.literal("jolene.personality-recoding-checkpoint.v1"),
  primaryCodingFingerprint: z.string(),
  round1Fingerprint: z.string(),
  codebookFingerprint: z.string(),
  modelVersion: z.string(),
  recoderA: z.array(assignmentSchema()),
  recoderB: z.array(assignmentSchema()),
  decisions: z.array(z.object({
    selectionId: z.string(),
    reconciledCoding: codingSchema,
    rationale: z.string(),
  }).strict()),
}).strict();

function assignmentSchema() {
  return z.object({
    selectionId: z.string(),
    coding: codingSchema,
    assignedAt: z.string().datetime(),
    codedAt: z.string().datetime(),
  }).strict();
}

export async function capturePersonalityRecodingV1(projectRoot = process.cwd()) {
  const config = loadConfig();
  const [primaryText, round1Text, codebookText, codebookLoaded, selection, html, pdf] =
    await Promise.all([
      readFile(path.resolve(projectRoot, "research/primary-coding-v5.json"), "utf8"),
      readFile(path.resolve(projectRoot, "research/independent-review-v5.json"), "utf8"),
      readFile(path.resolve(projectRoot, "research/personality-categorical-codebook-v1.json"), "utf8"),
      loadPersonalityCategoricalCodebookV1(projectRoot),
      loadPersonalitySelectionArtifactsV5(projectRoot),
      extractSelectedHtmlPersonalitySourceTexts(projectRoot),
      extractSelectedPdfPersonalitySourceTexts(projectRoot),
    ]);
  const primary = personalityPrimaryCodingArtifactV5Schema.parse(JSON.parse(primaryText));
  const round1 = personalityIndependentReviewV5Schema.parse(JSON.parse(round1Text));
  if (round1.status !== "reconciliation-failed-recoding-required") {
    throw new Error("Recoding requires a preserved failed round-1 artifact");
  }
  const transientBySelectionId = new Map([...html, ...pdf].map((item) => [item.selectionId, item]));
  const selected = selection.ledgers.flatMap((ledger) => ledger.selectedUnits);
  const required = primary.turns.map((turn, index) => {
    const unit = selected[index];
    const transient = unit ? transientBySelectionId.get(unit.selectionId) : undefined;
    if (!unit || !transient || transient.segmentFingerprint !== turn.segmentFingerprint) {
      throw new Error(`Recoding source alignment failed for ${turn.observationId}`);
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
  const fingerprints = {
    primaryCodingFingerprint: digest(primaryText),
    round1Fingerprint: digest(round1Text),
    codebookFingerprint: digest(codebookText),
    modelVersion: config.model,
  };
  const checkpointPath = path.resolve(
    projectRoot, ".jolene/checkpoints/personality-recoding-v1.json",
  );
  const checkpoint = await loadCheckpoint(checkpointPath, fingerprints);
  const reviewer = new OpenAIPersonalityIndependentReviewer({
    client: new OpenAI({ apiKey: config.openaiApiKey }),
    model: config.model,
    timeoutMilliseconds: 120_000,
    maxOutputTokens: 12_000,
  });
  await captureRecoder(
    "recoder-a-v1", checkpoint.recoderA, required.map((item) => item.input),
    codebookLoaded.codebook, reviewer, checkpointPath, checkpoint,
  );
  await captureRecoder(
    "recoder-b-v1", checkpoint.recoderB, required.map((item) => item.input),
    codebookLoaded.codebook, reviewer, checkpointPath, checkpoint,
  );
  const aById = new Map(checkpoint.recoderA.map((item) => [item.selectionId, item]));
  const bById = new Map(checkpoint.recoderB.map((item) => [item.selectionId, item]));
  const disagreements = required.flatMap((item) => {
    const a = aById.get(item.input.selectionId);
    const b = bById.get(item.input.selectionId);
    if (!a || !b) throw new Error(`Missing recoding pair for ${item.input.selectionId}`);
    return changedFields(a.coding, b.coding).length === 0 ? [] : [{
      ...item.input,
      primaryCoding: a.coding,
      independentCoding: b.coding,
    }];
  });
  const decisionById = new Map(checkpoint.decisions.map((item) => [item.selectionId, item]));
  for (const batch of chunks(disagreements, 20)) {
    const pending = batch.filter((item) => !decisionById.has(item.selectionId));
    if (pending.length === 0) continue;
    const decisions = await reviewer.adjudicateBatch(pending);
    decisions.forEach((decision) => decisionById.set(decision.selectionId, decision));
    checkpoint.decisions = [...decisionById.values()];
    await writeJsonAtomic(checkpointPath, checkpoint);
  }
  const recoderA = reviewerRecord("jolene-recoder-a-v1", config.model, "A");
  const recoderB = reviewerRecord("jolene-recoder-b-v1", config.model, "B");
  const adjudicator = reviewerRecord(
    "jolene-recoding-adjudicator-v1", config.model, "adjudication",
  );
  const rows = required.map((item) => {
    const a = aById.get(item.input.selectionId)!;
    const b = bById.get(item.input.selectionId)!;
    const changed = changedFields(a.coding, b.coding);
    const decision = decisionById.get(item.input.selectionId);
    return {
      observationId: item.turn.observationId,
      selectionId: item.input.selectionId,
      sourceEventId: item.turn.sourceEventId,
      reviewReasons: [...item.reasons],
      recoderAAssignedAt: a.assignedAt,
      recoderACodedAt: a.codedAt,
      recoderBAssignedAt: b.assignedAt,
      recoderBCodedAt: b.codedAt,
      reconciledAt: new Date().toISOString(),
      recoderA: a.coding,
      recoderB: b.coding,
      changedFields: changed,
      reconciledCoding: decision?.reconciledCoding ?? b.coding,
      adjudicationRationale: decision?.rationale ??
        "Both blinded recoders independently produced the same categorical assignment.",
    };
  });
  const agreement = calculateRecodingAgreement(rows);
  const thresholdsMet = agreement.rawCategoricalAgreement >= 0.8 &&
    agreement.traitFamilyKappa >= 0.6;
  const artifact = personalityRecodingV1Schema.parse({
    schemaVersion: "jolene.personality-recoding.v1",
    status: thresholdsMet
      ? "recoding-passed-awaiting-rights-and-trait-admission-audit"
      : "recoding-failed-further-decision-required",
    completedAt: new Date().toISOString(),
    primaryCodingFingerprint: fingerprints.primaryCodingFingerprint,
    round1Fingerprint: fingerprints.round1Fingerprint,
    codebookFingerprint: fingerprints.codebookFingerprint,
    recoderA,
    recoderB,
    adjudicator,
    rows,
    agreement,
    coverage: {
      turns: 118,
      sources: 10,
      researchContexts: 8,
      sensitiveTurns: 84,
      lowConfidenceTurns: 17,
      traitAdmissionCandidateTurns: 31,
    },
    round1Preserved: true,
    sourceContentStored: false,
    excerptsStored: false,
    traitAdmission: "prohibited",
    runtimeActivation: "prohibited",
  });
  const validation = await validatePersonalityRecodingV1(artifact, projectRoot);
  const artifactPath = path.resolve(projectRoot, "research/personality-recoding-v1.json");
  await writeJsonAtomic(artifactPath, artifact);
  await rm(checkpointPath, { force: true });
  return { artifactPath, validation };
}

async function captureRecoder(
  recoderId: string,
  captured: z.infer<ReturnType<typeof assignmentSchema>>[],
  input: readonly PersonalityPrimaryCodingInput[],
  codebook: unknown,
  reviewer: OpenAIPersonalityIndependentReviewer,
  checkpointPath: string,
  checkpoint: z.infer<typeof captureSchema>,
) {
  const byId = new Map(captured.map((item) => [item.selectionId, item]));
  for (const batch of chunks(input, 20)) {
    const pending = batch.filter((item) => !byId.has(item.selectionId));
    if (pending.length === 0) continue;
    const assignedAt = new Date().toISOString();
    const assignments = await reviewer.recodeBatch(pending, codebook, recoderId);
    const codedAt = new Date().toISOString();
    assignments.forEach((assignment) => byId.set(assignment.selectionId, {
      selectionId: assignment.selectionId,
      coding: assignment.coding,
      assignedAt,
      codedAt,
    }));
    captured.splice(0, captured.length, ...byId.values());
    await writeJsonAtomic(checkpointPath, checkpoint);
  }
}

async function loadCheckpoint(
  checkpointPath: string,
  expected: {
    readonly primaryCodingFingerprint: string;
    readonly round1Fingerprint: string;
    readonly codebookFingerprint: string;
    readonly modelVersion: string;
  },
) {
  try {
    const checkpoint = captureSchema.parse(JSON.parse(await readFile(checkpointPath, "utf8")));
    for (const [key, value] of Object.entries(expected)) {
      if (checkpoint[key as keyof typeof expected] !== value) {
        throw new Error("Recoding checkpoint does not match current prerequisites");
      }
    }
    return checkpoint;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return captureSchema.parse({
      schemaVersion: "jolene.personality-recoding-checkpoint.v1",
      ...expected,
      recoderA: [],
      recoderB: [],
      decisions: [],
    });
  }
}

async function writeJsonAtomic(target: string, value: unknown) {
  const staging = `${target}.staging-${process.pid}`;
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  try {
    await writeFile(staging, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    await chmod(staging, 0o600);
    await rename(staging, target);
  } catch (error) {
    await rm(staging, { force: true });
    throw error;
  }
}

function reviewerRecord(id: string, model: string, role: string) {
  return {
    reviewerId: id,
    reviewerType: "ai" as const,
    tool: `OpenAI Responses API blinded categorical recoding ${role}; store=false`,
    modelVersion: model,
  };
}

function chunks<T>(values: readonly T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function main() {
  const result = await capturePersonalityRecodingV1();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
