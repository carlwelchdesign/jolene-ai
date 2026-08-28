import {
  extractPersonalitySourceSegments,
  fingerprintPersonalitySourceContent,
  type NormalizedTranscriptFingerprintMethod,
} from "./personality-source-content-fingerprint.js";
import { fingerprintSamplingUnitSegments } from "./personality-sampling-selection.js";
import { loadPersonalitySelectionArtifactsV5 } from "./personality-selection-ledgers-v5.js";
import { loadPersonalitySourceRegisterV3 } from "./personality-source-register-v3.js";
import { fetchAllowedContentBoundary } from
  "../../scripts/validate-personality-source-content-fingerprints.js";

const htmlSourceIds = ["S02", "S03", "S05", "S13", "S19", "S20"] as const;
type HtmlSourceId = typeof htmlSourceIds[number];

export interface TransientSelectedPersonalitySourceText {
  readonly selectionId: string;
  readonly sourceRegisterId: HtmlSourceId;
  readonly sourceEventId: string;
  readonly locatorLabel: string;
  readonly selectionRuleId: "SAM-001" | "SAM-002";
  readonly agreedHighRiskStrata: readonly string[];
  readonly segmentFingerprint: string;
  readonly sourceText: string;
}

interface WorkingUnit {
  readonly segments: readonly string[];
  readonly locatorStart: number;
  readonly locatorEnd: number;
  readonly eligible: boolean;
}

export async function extractSelectedHtmlPersonalitySourceTexts(
  projectRoot = process.cwd(),
  fetcher: typeof fetch = fetch,
): Promise<readonly TransientSelectedPersonalitySourceText[]> {
  const [register, selection] = await Promise.all([
    loadPersonalitySourceRegisterV3(projectRoot),
    loadPersonalitySelectionArtifactsV5(projectRoot),
  ]);
  const results: TransientSelectedPersonalitySourceText[] = [];
  for (const sourceId of htmlSourceIds) {
    const source = register.events.find((candidate) => candidate.sourceRegisterId === sourceId);
    const ledger = selection.ledgers.find((candidate) => candidate.sourceRegisterId === sourceId);
    if (!source?.contentBoundaryUrl || !source.sourceContentFingerprint || !ledger) {
      throw new Error(`${sourceId} lacks frozen HTML coding prerequisites`);
    }
    const method = source.fingerprintMethod as NormalizedTranscriptFingerprintMethod;
    const retrieved = await fetchAllowedContentBoundary(
      source.contentBoundaryUrl,
      method,
      register.liveFingerprintPolicy,
      fetcher,
    );
    const fingerprint = fingerprintPersonalitySourceContent(method, retrieved.bytes);
    if (fingerprint.fingerprint !== source.sourceContentFingerprint) {
      throw new Error(`${sourceId} source content is stale before primary coding`);
    }
    const html = new TextDecoder("utf-8", { fatal: true }).decode(retrieved.bytes);
    const units = structuralUnits(sourceId, extractPersonalitySourceSegments(method, html));
    if (units.length !== ledger.sourceBoundaryUnitCount) {
      throw new Error(`${sourceId} structural unit count drifted before primary coding`);
    }
    for (const selected of ledger.selectedUnits) {
      const unit = units[selected.sourceUnitOrdinal];
      if (!unit?.eligible || unit.locatorStart !== selected.locator.start ||
          unit.locatorEnd !== selected.locator.end ||
          fingerprintSamplingUnitSegments(unit.segments) !== selected.segmentFingerprint) {
        throw new Error(`${sourceId}/${selected.selectionId} source segment drifted`);
      }
      results.push({
        selectionId: selected.selectionId,
        sourceRegisterId: sourceId,
        sourceEventId: ledger.sourceEventId,
        locatorLabel: selected.locator.label,
        selectionRuleId: selected.selectionRuleId,
        agreedHighRiskStrata: selected.agreedHighRiskStrata,
        segmentFingerprint: selected.segmentFingerprint,
        sourceText: unit.segments.join("\n"),
      });
    }
  }
  if (results.length !== 82 || new Set(results.map((item) => item.segmentFingerprint)).size !== 82) {
    throw new Error("Transient HTML primary-coding selection is incomplete or duplicated");
  }
  return results;
}

export function structuralHtmlPersonalityUnits(
  sourceId: HtmlSourceId,
  segments: readonly string[],
): readonly WorkingUnit[] {
  return structuralUnits(sourceId, segments);
}

function structuralUnits(sourceId: HtmlSourceId, segments: readonly string[]): readonly WorkingUnit[] {
  if (sourceId === "S03") return cnnUnits(segments);
  if (sourceId === "S20") return vanityUnits(segments);
  return segments.map((segment, index) => ({
    segments: [segment],
    locatorStart: index,
    locatorEnd: index,
    eligible: classifyParagraph(sourceId, segment),
  }));
}

function cnnUnits(segments: readonly string[]): readonly WorkingUnit[] {
  const label = /^(KING|PARTON|UNIDENTIIFIED MALE):(?:\s|$)/u;
  const starts = segments.flatMap((segment, index) => label.test(segment) ? [index] : []);
  if (starts.length !== 542 || starts[0] === 0) throw new Error("S03 label boundary changed");
  const units: WorkingUnit[] = [{
    segments: segments.slice(0, starts[0]),
    locatorStart: 0,
    locatorEnd: starts[0]! - 1,
    eligible: false,
  }];
  starts.forEach((start, index) => {
    const end = (starts[index + 1] ?? segments.length) - 1;
    units.push({
      segments: segments.slice(start, end + 1),
      locatorStart: start,
      locatorEnd: end,
      eligible: label.exec(segments[start]!)?.[1] === "PARTON",
    });
  });
  return units;
}

function vanityUnits(segments: readonly string[]): readonly WorkingUnit[] {
  if (segments.length !== 50) throw new Error("S20 pair boundary changed");
  return Array.from({ length: 25 }, (_, pairIndex) => ({
    segments: segments.slice(pairIndex * 2, pairIndex * 2 + 2),
    locatorStart: pairIndex,
    locatorEnd: pairIndex,
    eligible: true,
  }));
}

function classifyParagraph(
  sourceId: Exclude<HtmlSourceId, "S03" | "S20">,
  segment: string,
): boolean {
  if (sourceId === "S02") return /^Ms\. PARTON:/u.test(segment);
  if (sourceId === "S05") return /^Ms\. (?:DOLLY )?PARTON(?: \([^)]*\))?:/u.test(segment);
  if (sourceId === "S13") return /^Dolly Parton:/u.test(segment);
  return /^(?:DOLLY PARTON|PARTON):/u.test(segment);
}
