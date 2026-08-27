import { readFile } from "node:fs/promises";
import path from "node:path";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

import {
  preallocationBoundaryDraftSchema,
  validatePreallocationBoundaryDraft,
} from "../src/personality/personality-preallocation-boundary-draft.js";
import type { PreallocationBoundaryDraft } from
  "../src/personality/personality-preallocation-boundary-draft.js";
import { preallocationCapacityLedgerSchema } from
  "../src/personality/personality-preallocation-capacity-ledger.js";
import { loadPersonalitySamplingBoundaryProtocolV1 } from
  "../src/personality/personality-sampling-boundary-protocol.js";
import { loadPersonalitySourceRegisterV3 } from
  "../src/personality/personality-source-register-v3.js";

const hash = (value: number) => `sha256:${String(value).padStart(64, "0")}`;

describe("personality preallocation boundary draft", () => {
  it("accepts complete machine-only coverage without claiming review or selection", () => {
    expect(validatePreallocationBoundaryDraft(register(), protocol(), draft())).toMatchObject({
      sourceRegisterId: "S02", boundaryUnits: 3, eligibleUnits: 1,
      excludedRanges: 2, semanticReviewPerformed: false,
      independentReviewPerformed: false, selectionPerformed: false,
      draftFingerprint: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    });
  });

  it("cannot satisfy the independently reviewed capacity-ledger schema", () => {
    const parsed = preallocationCapacityLedgerSchema.safeParse(draft());
    expect(parsed.success).toBe(false);
  });

  it("rejects stale provenance, missing coverage, and a source-rule mismatch", () => {
    const stale = draft();
    stale.sourceRegisterFingerprint = hash(99);
    expect(() => validatePreallocationBoundaryDraft(register(), protocol(), stale))
      .toThrow("prerequisites are stale");

    const missing = draft();
    missing.excludedRanges = missing.excludedRanges.slice(0, 1);
    expect(() => validatePreallocationBoundaryDraft(register(), protocol(), missing))
      .toThrow("coverage is missing or overlapping");

    const wrongRule = draft();
    wrongRule.segmentationRule = "cnn-speaker-label-blocks-v1";
    expect(() => validatePreallocationBoundaryDraft(register(), protocol(), wrongRule))
      .toThrow("segmentation rule mismatch");
  });

  it("rejects wrong locator kinds, source ID prefixes, and reversed locators", () => {
    const wrongLocator = draft();
    wrongLocator.eligibleUnits[0]!.locator.kind = "pair-index";
    wrongLocator.eligibleUnits[0]!.locator.label = "pair-1";
    expect(() => validatePreallocationBoundaryDraft(register(), protocol(), wrongLocator))
      .toThrow("locator kind mismatch");

    const wrongPrefix = draft();
    wrongPrefix.eligibleUnits[0]!.unitId = "C-S03-0001";
    expect(() => validatePreallocationBoundaryDraft(register(), protocol(), wrongPrefix))
      .toThrow("ID prefix mismatch");

    const reversed = draft();
    reversed.excludedRanges[0]!.locator.start = 2;
    expect(preallocationBoundaryDraftSchema.safeParse(reversed).success).toBe(false);
  });

  it("validates every committed HTML draft and finds no source-content fields", async () => {
    const projectRoot = process.cwd();
    const [sourceRegister, boundaryProtocol] = await Promise.all([
      loadPersonalitySourceRegisterV3(projectRoot),
      loadPersonalitySamplingBoundaryProtocolV1(projectRoot),
    ]);
    const expected = new Map([
      ["S02", [257, 43]], ["S03", [543, 270]], ["S05", [72, 29]],
      ["S13", [61, 23]], ["S19", [118, 58]], ["S20", [25, 25]],
    ] as const);
    for (const [sourceId, counts] of expected) {
      const artifact = parse(await readFile(path.resolve(
        projectRoot, "research", "preallocation-boundary-drafts-v1",
        `source-${sourceId}.yaml`,
      ), "utf8"));
      expect(validatePreallocationBoundaryDraft(
        sourceRegister, boundaryProtocol, artifact,
      )).toMatchObject({
        sourceRegisterId: sourceId, boundaryUnits: counts[0], eligibleUnits: counts[1],
        semanticReviewPerformed: false, independentReviewPerformed: false,
        selectionPerformed: false,
      });
      expect(findForbiddenContentKeys(artifact)).toEqual([]);
    }
  });
});

function findForbiddenContentKeys(value: unknown, pathParts: readonly string[] = []): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findForbiddenContentKeys(item, [...pathParts, `${index}`]));
  }
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => {
    const path = [...pathParts, key];
    return ["text", "content", "excerpt", "quote", "transcript", "lyrics"].includes(key)
      ? [path.join(".")]
      : findForbiddenContentKeys(item, path);
  });
}

function register() {
  return {
    registerFingerprint: hash(1),
    events: [{
      sourceRegisterId: "S02", sourceEventId: "E002", accessState: "coding-ready",
      sourceContentFingerprint: hash(2),
    }],
  } as never;
}

function protocol() {
  return {
    protocolFingerprint: hash(3), highRiskTaxonomyFingerprint: hash(4),
  } as never;
}

function draft(): PreallocationBoundaryDraft {
  return {
    schemaVersion: "jolene.personality-preallocation-boundary-draft.v1",
    status: "machine-generated-awaiting-dual-review-and-tags",
    generatedAt: "2026-08-27T12:00:00Z", generatorId: "html-boundary-generator-v1",
    sourceRegisterFingerprint: hash(1), boundaryProtocolFingerprint: hash(3),
    highRiskTaxonomyFingerprint: hash(4), sourceRegisterId: "S02", sourceEventId: "E002",
    sourceContentFingerprint: hash(2), segmentationRule: "paragraph-speaker-blocks-v1",
    sourceBoundaryUnitCount: 3,
    eligibleUnits: [{
      unitId: "C-S02-0001", sourceUnitOrdinal: 1,
      locator: { kind: "paragraph-index", start: 1, end: 1, label: "paragraph-1" },
      segmentFingerprint: hash(11),
    }],
    excludedRanges: [
      {
        exclusionId: "CX-S02-0001", sourceUnitStart: 0, sourceUnitEnd: 0,
        locator: { kind: "paragraph-index", start: 0, end: 0, label: "paragraph-0" },
        segmentFingerprint: hash(10), reason: "interviewer-or-other-speaker",
      },
      {
        exclusionId: "CX-S02-0002", sourceUnitStart: 2, sourceUnitEnd: 2,
        locator: { kind: "paragraph-index", start: 2, end: 2, label: "paragraph-2" },
        segmentFingerprint: hash(12), reason: "speaker-attribution-unclear",
      },
    ],
    sourceContentStored: false, semanticReviewPerformed: false,
    independentReviewPerformed: false, selectionPerformed: false,
  };
}
