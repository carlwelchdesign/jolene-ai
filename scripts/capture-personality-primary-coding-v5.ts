import { chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import OpenAI from "openai";
import { z } from "zod";

import { loadConfig } from "../src/config.js";
import {
  OpenAIPersonalityPrimaryCoder,
  type PersonalityPrimaryCodingInput,
  type PersonalityPrimaryCodingResult,
} from "../src/personality/openai-personality-primary-coder.js";
import {
  buildPrimaryCodingArtifactV5,
  loadPersonalityPrimaryCodingPrerequisitesV5,
  validatePersonalityPrimaryCodingArtifactV5,
} from "../src/personality/personality-primary-coding-v5.js";
import { researchContextSchema } from
  "../src/personality/personality-corpus-contract.js";
import { validatePrimaryCodingRightsV5 } from
  "../src/personality/personality-primary-coding-rights-v5.js";
import { extractSelectedHtmlPersonalitySourceTexts } from
  "../src/personality/personality-selected-html-source-text.js";
import { extractSelectedPdfPersonalitySourceTexts } from
  "../src/personality/personality-selected-pdf-source-text.js";

export interface PrimaryCodingCaptureDependencies {
  readonly modelVersion: string;
  readonly codeBatch: (
    input: readonly PersonalityPrimaryCodingInput[],
  ) => Promise<readonly PersonalityPrimaryCodingResult[]>;
  readonly htmlSourceTexts?: typeof extractSelectedHtmlPersonalitySourceTexts;
  readonly pdfSourceTexts?: typeof extractSelectedPdfPersonalitySourceTexts;
  readonly now?: () => Date;
}

export async function capturePersonalityPrimaryCodingV5(
  dependencies: PrimaryCodingCaptureDependencies,
  projectRoot = process.cwd(),
) {
  const [{ selection, register }, html, pdf] = await Promise.all([
    loadPersonalityPrimaryCodingPrerequisitesV5(projectRoot),
    (dependencies.htmlSourceTexts ?? extractSelectedHtmlPersonalitySourceTexts)(projectRoot),
    (dependencies.pdfSourceTexts ?? extractSelectedPdfPersonalitySourceTexts)(projectRoot),
  ]);
  const transientBySelectionId = new Map(
    [...html, ...pdf].map((item) => [item.selectionId, item]),
  );
  if (transientBySelectionId.size !== 120) {
    throw new Error("Primary coding requires exactly 120 unique transient source turns");
  }

  const ordered = selection.ledgers.flatMap((ledger) => ledger.selectedUnits.map((unit) => {
    const transient = transientBySelectionId.get(unit.selectionId);
    if (!transient || transient.sourceRegisterId !== ledger.sourceRegisterId ||
        transient.sourceEventId !== ledger.sourceEventId ||
        transient.segmentFingerprint !== unit.segmentFingerprint) {
      throw new Error(`Transient source text does not match ${unit.selectionId}`);
    }
    return { ledger, unit, transient };
  }));

  const codedBySelectionId = new Map<string, PersonalityPrimaryCodingResult>();
  for (const ledger of selection.ledgers) {
    const batch = ordered.filter((item) => item.ledger.sourceRegisterId === ledger.sourceRegisterId)
      .map(({ transient }): PersonalityPrimaryCodingInput => ({
        selectionId: transient.selectionId,
        sourceRegisterId: transient.sourceRegisterId,
        sourceEventId: transient.sourceEventId,
        locatorLabel: transient.locatorLabel,
        selectionRuleId: transient.selectionRuleId,
        agreedHighRiskStrata: transient.agreedHighRiskStrata,
        sourceText: transient.sourceText,
      }));
    const results = await dependencies.codeBatch(batch);
    results.forEach((result) => codedBySelectionId.set(result.selectionId, result));
  }
  await adjudicateContextCoverage(
    ordered.map(({ transient }) => transient),
    codedBySelectionId,
    dependencies.codeBatch,
  );
  if (codedBySelectionId.size !== 120) {
    throw new Error("Primary coder did not return exactly 120 unique results");
  }

  const codedAt = (dependencies.now ?? (() => new Date()))().toISOString();
  const primaryReviewer = {
    reviewerId: "jolene-primary-coder-v5",
    reviewerType: "ai" as const,
    tool: "OpenAI Responses API structured primary coding; store=false",
    modelVersion: dependencies.modelVersion,
  };
  const sourceByEvent = new Map(register.events.map((source) => [source.sourceEventId, source]));
  const turns = ordered.map(({ ledger, unit }, index) => {
    const source = sourceByEvent.get(ledger.sourceEventId);
    const coding = codedBySelectionId.get(unit.selectionId);
    if (!source || !coding) throw new Error(`Missing primary coding inputs for ${unit.selectionId}`);
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
      paraphrase: coding.paraphrase,
      segmentFingerprint: unit.segmentFingerprint,
      sampleRuleId: unit.selectionRuleId,
      speechAct: coding.speechAct,
      researchContext: coding.researchContext,
      traitFamilyId: coding.traitFamilyId,
      seriousnessPivot: coding.seriousnessPivot,
      observationEvidenceClass: "observed" as const,
      traitEvidenceClass: coding.traitEvidenceClass,
      adaptationEvidenceClass: coding.adaptationEvidenceClass,
      confidence: coding.confidence,
      sensitiveStrata: unit.agreedHighRiskStrata,
      alternativeInterpretation: coding.alternativeInterpretation,
      doNotCopy: coding.doNotCopy,
      primaryReviewer: { ...primaryReviewer, codedAt },
    };
  });
  const artifact = buildPrimaryCodingArtifactV5({
    codedAt,
    selectionManifestFingerprint: selection.manifestFingerprint,
    samplingPlanFingerprint: selection.ledgers[0]!.samplingPlanFingerprint,
    sourceRegisterFingerprint: register.registerFingerprint,
    primaryReviewer,
    turns,
  });
  validatePrimaryCodingRightsV5(
    artifact,
    ordered.map(({ transient }) => transient),
  );
  const validation = await validatePersonalityPrimaryCodingArtifactV5(artifact, projectRoot);
  return { artifact, validation };
}

const compatibleTraitsByContext = {
  attribution: ["credit-aware-authority", "uncertainty-humility"],
  boundaries: ["bounded-warmth", "disciplined-agency", "uncertainty-humility"],
  care: ["operational-care", "bounded-warmth", "grounded-optimism"],
  humor: ["calibrated-wit", "bounded-warmth"],
  leadership: ["credit-aware-authority", "disciplined-agency", "operational-care"],
  recovery: ["candid-repair", "grounded-optimism", "operational-care"],
  uncertainty: ["uncertainty-humility", "candid-repair"],
  "work-practice": ["disciplined-agency", "operational-care", "credit-aware-authority"],
} as const;

async function adjudicateContextCoverage(
  transient: readonly (PersonalityPrimaryCodingInput & { readonly segmentFingerprint: string })[],
  coded: Map<string, PersonalityPrimaryCodingResult>,
  codeBatch: PrimaryCodingCaptureDependencies["codeBatch"],
) {
  for (const context of researchContextSchema.options) {
    while (contextCount(coded, context) < 5 || contextSources(coded, transient, context).size < 2) {
      const currentSources = contextSources(coded, transient, context);
      const candidate = transient.find((item) => {
        const result = coded.get(item.selectionId);
        if (!result || result.researchContext === context ||
            !compatibleTraitsByContext[context].some((trait) => trait === result.traitFamilyId)) {
          return false;
        }
        const donorCount = contextCount(coded, result.researchContext);
        const donorSources = contextSources(coded, transient, result.researchContext);
        const donorSourceCount = [...transient].filter((entry) =>
          entry.sourceRegisterId === item.sourceRegisterId &&
          coded.get(entry.selectionId)?.researchContext === result.researchContext).length;
        const sourceAddsDiversity = currentSources.size >= 2 ||
          !currentSources.has(item.sourceRegisterId);
        return donorCount > 5 && (donorSources.size > 2 || donorSourceCount > 1) &&
          sourceAddsDiversity;
      });
      if (!candidate) {
        throw new Error(`No compatible primary-coding adjudication candidate for ${context}`);
      }
      const [replacement] = await codeBatch([{ ...candidate, requiredResearchContext: context }]);
      if (!replacement) throw new Error(`Missing context adjudication result for ${context}`);
      coded.set(replacement.selectionId, replacement);
    }
  }
}

function contextCount(
  coded: ReadonlyMap<string, PersonalityPrimaryCodingResult>,
  context: z.infer<typeof researchContextSchema>,
) {
  return [...coded.values()].filter((result) => result.researchContext === context).length;
}

function contextSources(
  coded: ReadonlyMap<string, PersonalityPrimaryCodingResult>,
  transient: readonly PersonalityPrimaryCodingInput[],
  context: z.infer<typeof researchContextSchema>,
) {
  return new Set(transient.filter((item) =>
    coded.get(item.selectionId)?.researchContext === context).map((item) => item.sourceRegisterId));
}

export async function writePersonalityPrimaryCodingV5(
  artifact: Awaited<ReturnType<typeof capturePersonalityPrimaryCodingV5>>["artifact"],
  projectRoot = process.cwd(),
) {
  const target = path.resolve(projectRoot, "research/primary-coding-v5.json");
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
  const coder = new OpenAIPersonalityPrimaryCoder({
    client: new OpenAI({ apiKey: config.openaiApiKey }),
    model: config.model,
    timeoutMilliseconds: 120_000,
    maxOutputTokens: 12_000,
  });
  const { artifact, validation } = await capturePersonalityPrimaryCodingV5({
    modelVersion: config.model,
    codeBatch: (input) => coder.codeBatch(input),
  });
  const artifactPath = await writePersonalityPrimaryCodingV5(artifact);
  process.stdout.write(`${JSON.stringify({
    artifactPath,
    model: config.model,
    ...validation,
    sourceContentStored: false,
    independentReviewPerformed: false,
    runtimeActivation: "prohibited",
  }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
