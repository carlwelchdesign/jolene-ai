import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { stringify } from "yaml";

import { fetchAllowedContentBoundary } from
  "./validate-personality-source-content-fingerprints.js";
import { validatePreallocationBoundaryDraft } from
  "../src/personality/personality-preallocation-boundary-draft.js";
import type { PreallocationBoundaryDraft } from
  "../src/personality/personality-preallocation-boundary-draft.js";
import { loadPersonalitySamplingBoundaryProtocolV1 } from
  "../src/personality/personality-sampling-boundary-protocol.js";
import { fingerprintSamplingUnitSegments } from
  "../src/personality/personality-sampling-selection.js";
import { extractPersonalitySourceSegments } from
  "../src/personality/personality-source-content-fingerprint.js";
import type { NormalizedTranscriptFingerprintMethod } from
  "../src/personality/personality-source-content-fingerprint.js";
import { loadPersonalitySourceRegisterV3 } from
  "../src/personality/personality-source-register-v3.js";

const sourceIds = ["S02", "S03", "S05", "S13", "S19", "S20"] as const;
type SourceId = typeof sourceIds[number];
type LocatorKind = PreallocationBoundaryDraft["eligibleUnits"][number]["locator"]["kind"];
type ExclusionReason = "interviewer-or-other-speaker" | "not-atomic" |
  "speaker-attribution-unclear";
interface WorkingUnit {
  readonly segments: readonly string[];
  readonly locatorStart: number;
  readonly locatorEnd: number;
  readonly eligible: boolean;
  readonly reason: ExclusionReason | null;
}

const expectedCounts: Readonly<Record<SourceId, {
  readonly boundaryUnits: number;
  readonly eligibleUnits: number;
}>> = {
  S02: { boundaryUnits: 257, eligibleUnits: 43 },
  S03: { boundaryUnits: 543, eligibleUnits: 270 },
  S05: { boundaryUnits: 72, eligibleUnits: 29 },
  S13: { boundaryUnits: 61, eligibleUnits: 23 },
  S19: { boundaryUnits: 118, eligibleUnits: 58 },
  S20: { boundaryUnits: 25, eligibleUnits: 25 },
};

export async function generatePersonalityHtmlBoundaryDrafts(projectRoot = process.cwd()) {
  const [register, protocol] = await Promise.all([
    loadPersonalitySourceRegisterV3(projectRoot),
    loadPersonalitySamplingBoundaryProtocolV1(projectRoot),
  ]);
  const generatedAt = new Date().toISOString();
  const outputRoot = path.resolve(projectRoot, "research", "preallocation-boundary-drafts-v1");
  const generated = [];
  for (const sourceId of sourceIds) {
    const source = register.events.find((candidate) => candidate.sourceRegisterId === sourceId);
    if (!source?.contentBoundaryUrl || !source.sourceContentFingerprint) {
      throw new Error(`${sourceId} lacks a registered HTML boundary`);
    }
    const method = source.fingerprintMethod as NormalizedTranscriptFingerprintMethod;
    const retrieved = await fetchAllowedContentBoundary(
      source.contentBoundaryUrl, method, register.liveFingerprintPolicy,
    );
    const html = new TextDecoder("utf-8", { fatal: true }).decode(retrieved.bytes);
    const segments = extractPersonalitySourceSegments(method, html);
    const units = structuralUnits(sourceId, segments);
    const draft = buildDraft(register, protocol, sourceId, source, units, generatedAt);
    const summary = validatePreallocationBoundaryDraft(register, protocol, draft);
    const expected = expectedCounts[sourceId];
    if (summary.boundaryUnits !== expected.boundaryUnits ||
        summary.eligibleUnits !== expected.eligibleUnits) {
      throw new Error(
        `${sourceId} structural capacity changed: expected ` +
        `${expected.boundaryUnits}/${expected.eligibleUnits}, received ` +
        `${summary.boundaryUnits}/${summary.eligibleUnits}`,
      );
    }
    generated.push({ sourceId, draft, summary });
  }
  await mkdir(outputRoot, { recursive: true });
  for (const item of generated) {
    await writeFile(
      path.resolve(outputRoot, `source-${item.sourceId}.yaml`), stringify(item.draft), "utf8",
    );
  }
  const summaries = generated.map((item) => item.summary);
  return { generatedDrafts: summaries.length, sources: summaries };
}

function structuralUnits(sourceId: SourceId, segments: readonly string[]): readonly WorkingUnit[] {
  if (sourceId === "S03") return cnnUnits(segments);
  if (sourceId === "S20") return vanityUnits(segments);
  return segments.map((segment, index) => ({
    segments: [segment], locatorStart: index, locatorEnd: index,
    ...classifyParagraph(sourceId, segment),
  }));
}

function cnnUnits(segments: readonly string[]): readonly WorkingUnit[] {
  const label = /^(KING|PARTON|UNIDENTIIFIED MALE):(?:\s|$)/;
  const starts = segments.flatMap((segment, index) => label.test(segment) ? [index] : []);
  if (starts.length !== 542 || starts[0] === 0) throw new Error("S03 label boundary changed");
  const units: WorkingUnit[] = [{
    segments: segments.slice(0, starts[0]), locatorStart: 0, locatorEnd: starts[0]! - 1,
    eligible: false, reason: "speaker-attribution-unclear",
  }];
  starts.forEach((start, index) => {
    const end = (starts[index + 1] ?? segments.length) - 1;
    const match = label.exec(segments[start]!);
    units.push({
      segments: segments.slice(start, end + 1), locatorStart: start, locatorEnd: end,
      eligible: match?.[1] === "PARTON",
      reason: match?.[1] === "PARTON" ? null : "interviewer-or-other-speaker",
    });
  });
  return units;
}

function vanityUnits(segments: readonly string[]): readonly WorkingUnit[] {
  if (segments.length !== 50) throw new Error("S20 pair boundary changed");
  return Array.from({ length: 25 }, (_, pairIndex) => ({
    segments: segments.slice(pairIndex * 2, pairIndex * 2 + 2),
    locatorStart: pairIndex, locatorEnd: pairIndex, eligible: true, reason: null,
  }));
}

function classifyParagraph(sourceId: Exclude<SourceId, "S03" | "S20">, segment: string) {
  if (sourceId === "S02") {
    if (/^Ms\. PARTON:/.test(segment)) return { eligible: true, reason: null } as const;
    if (/^Ms\. PARTON and /.test(segment)) return { eligible: false, reason: "not-atomic" } as const;
    if (/^(?:GROSS|Mr\. RICH|TERRY GROSS|Terry Gross|Ms\. DOLLY PARTON|Mr\. CHARLIE RICH)/.test(
      segment,
    )) return { eligible: false, reason: "interviewer-or-other-speaker" } as const;
  }
  if (sourceId === "S05") {
    if (/^Ms\. (?:DOLLY )?PARTON(?: \([^)]*\))?:/.test(segment)) {
      return { eligible: true, reason: null } as const;
    }
    if (/^(?:MARTIN|MICHEL MARTIN|Ms\. WHITNEY HOUSTON)/.test(segment)) {
      return { eligible: false, reason: "interviewer-or-other-speaker" } as const;
    }
  }
  if (sourceId === "S13") {
    if (/^Dolly Parton:/.test(segment)) return { eligible: true, reason: null } as const;
    if (/^Adam Grant:/.test(segment)) {
      return { eligible: false, reason: "interviewer-or-other-speaker" } as const;
    }
  }
  if (sourceId === "S19") {
    if (/^(?:DOLLY PARTON|PARTON):/.test(segment)) return { eligible: true, reason: null } as const;
    return { eligible: false, reason: "interviewer-or-other-speaker" } as const;
  }
  return { eligible: false, reason: "speaker-attribution-unclear" } as const;
}

function buildDraft(
  register: Awaited<ReturnType<typeof loadPersonalitySourceRegisterV3>>,
  protocol: Awaited<ReturnType<typeof loadPersonalitySamplingBoundaryProtocolV1>>,
  sourceId: SourceId,
  source: Awaited<ReturnType<typeof loadPersonalitySourceRegisterV3>>["events"][number],
  units: readonly WorkingUnit[],
  generatedAt: string,
): PreallocationBoundaryDraft {
  const locatorKind: LocatorKind = sourceId === "S20" ? "pair-index" :
    sourceId === "S03" || sourceId === "S19" ? "speaker-block-index" :
      "paragraph-index";
  const locatorLabel = locatorKind.replace("-index", "");
  const eligibleUnits = units.flatMap((unit, ordinal) => unit.eligible ? [{
    unitId: `C-${sourceId}-${String(ordinal + 1).padStart(4, "0")}`,
    sourceUnitOrdinal: ordinal,
    locator: {
      kind: locatorKind, start: unit.locatorStart, end: unit.locatorEnd,
      label: `${locatorLabel}-${ordinal}`,
    },
    segmentFingerprint: fingerprintSamplingUnitSegments(unit.segments),
  }] : []);
  const excludedRanges = groupExcluded(units).map((range, index) => ({
    exclusionId: `CX-${sourceId}-${String(index + 1).padStart(4, "0")}`,
    sourceUnitStart: range.start, sourceUnitEnd: range.end,
    locator: {
      kind: locatorKind, start: units[range.start]!.locatorStart,
      end: units[range.end]!.locatorEnd,
      label: `${locatorLabel}-${range.start}-${range.end}`,
    },
    segmentFingerprint: fingerprintSamplingUnitSegments(range.segments), reason: range.reason,
  }));
  return {
    schemaVersion: "jolene.personality-preallocation-boundary-draft.v1",
    status: "machine-generated-awaiting-dual-review-and-tags",
    generatedAt, generatorId: "html-boundary-generator-v1",
    sourceRegisterFingerprint: register.registerFingerprint,
    boundaryProtocolFingerprint: protocol.protocolFingerprint,
    highRiskTaxonomyFingerprint: protocol.highRiskTaxonomyFingerprint,
    sourceRegisterId: sourceId, sourceEventId: source.sourceEventId,
    sourceContentFingerprint: source.sourceContentFingerprint!,
    segmentationRule: sourceId === "S03" ? "cnn-speaker-label-blocks-v1" :
      sourceId === "S19" ? "interview-speaker-label-blocks-v1" :
      sourceId === "S20" ? "vanity-proust-answer-pairs-v1" : "paragraph-speaker-blocks-v1",
    sourceBoundaryUnitCount: units.length, eligibleUnits, excludedRanges,
    sourceContentStored: false, semanticReviewPerformed: false,
    independentReviewPerformed: false, selectionPerformed: false,
  };
}

function groupExcluded(units: readonly WorkingUnit[]) {
  const ranges: Array<{
    start: number; end: number; reason: ExclusionReason; segments: string[];
  }> = [];
  units.forEach((unit, ordinal) => {
    if (unit.eligible || !unit.reason) return;
    const prior = ranges.at(-1);
    if (prior?.end === ordinal - 1 && prior.reason === unit.reason) {
      prior.end = ordinal;
      prior.segments.push(...unit.segments);
    } else {
      ranges.push({ start: ordinal, end: ordinal, reason: unit.reason, segments: [...unit.segments] });
    }
  });
  return ranges;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = await generatePersonalityHtmlBoundaryDrafts();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
