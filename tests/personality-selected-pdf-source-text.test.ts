import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { extractSelectedPdfPersonalitySourceTexts } from
  "../src/personality/personality-selected-pdf-source-text.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

describe("transient selected PDF source text", () => {
  it("validates stdout without writing source content to the repository", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "jolene-pdf-text-test-"));
    temporaryDirectories.push(directory);
    const fixture = {
      schemaVersion: "jolene.transient-selected-pdf-source-text.v1",
      sourceContentStored: false,
      selected: Array.from({ length: 38 }, (_, index) => ({
        selectionId: `SEL-S04-${String(index + 1).padStart(4, "0")}`,
        sourceRegisterId: "S04",
        sourceEventId: "E004",
        locatorLabel: `section-${index + 1}`,
        selectionRuleId: index < 24 ? "SAM-002" : "SAM-001",
        agreedHighRiskStrata: index < 24 ? ["biography"] : [],
        segmentFingerprint: `sha256:${index.toString(16).padStart(64, "0")}`,
        sourceText: `Transient source unit ${index + 1}`,
      })),
    };
    const executable = path.join(directory, "fixture.cjs");
    await writeFile(executable, `process.stdout.write(${JSON.stringify(JSON.stringify(fixture))})`);
    const selected = await extractSelectedPdfPersonalitySourceTexts(directory, {
      pythonPath: process.execPath,
      extractorPath: executable,
    });
    expect(selected).toHaveLength(38);
    expect(selected[0]?.sourceText).toBe("Transient source unit 1");
  });
});
