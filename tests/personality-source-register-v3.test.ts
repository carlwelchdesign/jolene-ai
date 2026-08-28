import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { parse, stringify } from "yaml";
import { describe, expect, it } from "vitest";

import { validatePersonalitySourcesV3 } from
  "../scripts/validate-personality-sources-v3.js";
import { loadPersonalitySourceRegisterV3 } from
  "../src/personality/personality-source-register-v3.js";

describe("personality source register v3 repair", () => {
  it("downgrades unattributed sources and restores every diversity gate prospectively", async () => {
    await expect(validatePersonalitySourcesV3()).resolves.toMatchObject({
      schemaVersion: "jolene.personality-source-register.v3",
      registerFingerprint: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      registeredEvents: 16,
      registeredPublisherFamilies: 13,
      codingReadyEvents: 10,
      codingReadyPublisherFamilies: 9,
      codingReadySettingFamilies: 8,
      codingReadyTimeBands: 4,
      excludedEvents: 4,
      zeroAttributionSourcesDowngraded: ["S07", "S16", "S17"],
      replacementSources: ["S19", "S20"],
      gateGaps: { sourceEvents: 0, publisherFamilies: 0, settingFamilies: 0, timeBands: 0 },
      runtimeActivation: "prohibited",
    });
  });

  it("binds the two replacements to conservative dates, settings, and normalized boundaries", async () => {
    const register = await loadPersonalitySourceRegisterV3();
    expect(register.events.filter((source) => ["S19", "S20"].includes(
      source.sourceRegisterId,
    )).map((source) => ({
      id: source.sourceRegisterId, event: source.sourceEventId, date: source.date,
      publisher: source.publisherFamilyId, setting: source.settingFamily,
      method: source.fingerprintMethod, fingerprint: source.sourceContentFingerprint,
      url: source.url, title: source.title,
    }))).toEqual([
      {
        id: "S19", event: "E015", date: "1984", publisher: "interview-magazine",
        setting: "informal-candid-interview",
        method: "interview-magazine-speaker-paragraphs-v1",
        fingerprint: "sha256:b1765353abd7f2d2c562d3447d9bd2a20e168c81d619a9ecf6e6f6604ecd0449",
        url: "https://www.interviewmagazine.com/culture/new-again-dolly-parton",
        title: "New Again: Dolly Parton",
      },
      {
        id: "S20", event: "E016", date: "2012-10-24", publisher: "vanity-fair",
        setting: "structured-prompt-interview", method: "vanity-fair-proust-pairs-v1",
        fingerprint: "sha256:1e551fd24168a6120aa89530ca8dcd513cf014f6a8a6bb1c78622faadbd0aa08",
        url: "https://www.vanityfair.com/culture/2012/11/dolly-parton-proust-questionnaire",
        title: "The Proust Questionnaire: Dolly Parton",
      },
    ]);
    for (const id of ["S07", "S16", "S17"]) {
      expect(register.events.find((source) => source.sourceRegisterId === id)?.accessState)
        .toBe("excluded");
    }
  });

  it("rejects a repair detached from the immutable v2 register", async () => {
    const root = await fixtureRoot((repair) => {
      repair.base_register.fingerprint = `sha256:${"0".repeat(64)}`;
    });
    await expect(loadPersonalitySourceRegisterV3(root))
      .rejects.toThrow("Source-register v3 repair prerequisites are stale");
  });

  it("rejects a live policy that assigns a replacement the wrong extraction method", async () => {
    const root = await fixtureRoot((repair) => {
      repair.live_fingerprint_verification.fingerprint_methods[9] =
        "interview-magazine-speaker-paragraphs-v1";
    });
    await expect(loadPersonalitySourceRegisterV3(root))
      .rejects.toThrow("Source-register v3 live policy mismatch for S20");
  });

  it("binds the exact AV failure outcome rather than only its status", async () => {
    const root = await fixtureRoot((repair) => {
      repair.av_recovery_outcome_fingerprint = `sha256:${"0".repeat(64)}`;
    });
    await expect(loadPersonalitySourceRegisterV3(root))
      .rejects.toThrow("Source-register v3 repair prerequisites are stale");
  });

  it("rejects a repair reviewed before the AV recovery outcome", async () => {
    const root = await fixtureRoot((repair) => {
      repair.reviewed_at = "2026-08-27T10:24:59Z";
    });
    await expect(loadPersonalitySourceRegisterV3(root))
      .rejects.toThrow("Source-register v3 repair predates its prerequisites");
  });
});

interface RepairFixture {
  av_recovery_outcome_fingerprint: string;
  base_register: { fingerprint: string };
  reviewed_at: string;
  live_fingerprint_verification: { fingerprint_methods: string[] };
}

async function fixtureRoot(change: (repair: RepairFixture) => void): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "jolene-source-register-v3-"));
  const research = path.join(root, "research");
  await mkdir(research);
  const sourceRoot = path.join(process.cwd(), "research");
  const files = [
    "source-register-v3-repair.yaml", "av-attribution-recovery-outcome-v1.yaml",
    "sampling-boundary-protocol-v1.yaml", "allocation-capacity-audit-v1.yaml",
    "sampling-plan-v3.yaml", "sampling-plan-v3-outcome.yaml",
    "source-events-v2.yaml", "sources.yaml",
  ];
  const texts = await Promise.all(files.map((file) => readFile(path.join(sourceRoot, file), "utf8")));
  const repair = parse(texts[0]!) as RepairFixture;
  change(repair);
  texts[0] = stringify(repair);
  await Promise.all(files.map((file, index) =>
    writeFile(path.join(research, file), texts[index]!, "utf8")));
  return root;
}
