import { readFile } from "node:fs/promises";
import path from "node:path";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

import { preallocationBoundaryDraftSchema } from
  "../src/personality/personality-preallocation-boundary-draft.js";
import {
  buildHtmlLedgerFingerprintMap, htmlLedgerFingerprintMapSchema,
} from "../src/personality/personality-html-ledger-fingerprint-map.js";

const sourceIds = ["S02", "S03", "S05", "S13", "S19", "S20"] as const;

describe("personality HTML ledger fingerprint maps", () => {
  it("binds every metadata-only draft record to the canonical ledger fingerprint", async () => {
    for (const sourceId of sourceIds) {
      const draftText = await readFile(path.resolve(
        "research/preallocation-boundary-drafts-v1", `source-${sourceId}.yaml`,
      ), "utf8");
      const draft = preallocationBoundaryDraftSchema.parse(parse(draftText));
      const committed = htmlLedgerFingerprintMapSchema.parse(JSON.parse(await readFile(
        path.resolve("research/html-ledger-fingerprint-maps-v1", `source-${sourceId}.json`),
        "utf8",
      )));
      expect(committed).toEqual(buildHtmlLedgerFingerprintMap(draft, draftText));
      expect(committed.records).toHaveLength(
        draft.eligibleUnits.length + draft.excludedRanges.length,
      );
      expect(committed.records.every((record) =>
        record.boundarySegmentFingerprint === record.ledgerSegmentFingerprint
      )).toBe(true);
      expect(committed).toMatchObject({
        sourceContentStored: false,
        selectionPerformed: false,
        observationCodingPerformed: false,
        runtimeActivation: "prohibited",
      });
    }
  });

  it("rejects a map containing source-content fields", () => {
    const parsed = htmlLedgerFingerprintMapSchema.safeParse({
      schemaVersion: "jolene.personality-html-ledger-fingerprint-map.v1",
      sourceRegisterId: "S02",
      sourceContentFingerprint: `sha256:${"0".repeat(64)}`,
      boundaryDraftFingerprint: `sha256:${"1".repeat(64)}`,
      records: [],
      sourceContentStored: false,
      selectionPerformed: false,
      observationCodingPerformed: false,
      runtimeActivation: "prohibited",
      transcript: "forbidden",
    });
    expect(parsed.success).toBe(false);
  });
});
