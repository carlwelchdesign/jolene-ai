import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { parse, stringify } from "yaml";
import { describe, expect, it } from "vitest";

import { validatePersonalitySamplingPlan } from
  "../scripts/validate-personality-sampling-plan.js";
import { loadPersonalitySamplingPlanV2 } from
  "../src/personality/personality-sampling-plan.js";
import type { PersonalitySamplingPlan } from
  "../src/personality/personality-sampling-plan.js";

describe("personality sampling plan v2", () => {
  it("freezes a balanced 120-turn plan before primary coding", async () => {
    await expect(validatePersonalitySamplingPlan()).resolves.toMatchObject({
      schemaVersion: "jolene.personality-sampling-plan.v2",
      planFingerprint: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      targetAtomicTurns: 120,
      systematicTurns: 96,
      purposiveHighRiskTurns: 24,
      sourceEvents: 11,
      publisherFamilies: 8,
      settingFamilies: 8,
      timeBands: 4,
      runtimeActivation: "prohibited",
    });
  });

  it("pins the plan to the exact source-register snapshot", async () => {
    const root = await fixtureRoot((plan) => {
      plan.source_register.fingerprint = `sha256:${"0".repeat(64)}`;
    });
    await expect(loadPersonalitySamplingPlanV2(root))
      .rejects.toThrow("source-register snapshot is stale");
  });

  it("rejects allocation changes that violate the precommitted total", async () => {
    const root = await fixtureRoot((plan) => {
      const first = plan.source_allocations[0];
      if (!first) throw new Error("Missing fixture allocation");
      first.target_turns = 9;
      first.systematic_turns = 7;
    });
    await expect(loadPersonalitySamplingPlanV2(root))
      .rejects.toThrow("Invalid target turn allocation");
  });
});

async function fixtureRoot(change: (plan: PersonalitySamplingPlan) => void): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "jolene-sampling-plan-"));
  const research = path.join(root, "research");
  await mkdir(research);
  const projectRoot = process.cwd();
  const [planText, sourceEvents, legacySources] = await Promise.all([
    readFile(path.join(projectRoot, "research", "sampling-plan-v2.yaml"), "utf8"),
    readFile(path.join(projectRoot, "research", "source-events-v2.yaml"), "utf8"),
    readFile(path.join(projectRoot, "research", "sources.yaml"), "utf8"),
  ]);
  const plan = parse(planText) as PersonalitySamplingPlan;
  change(plan);
  await Promise.all([
    writeFile(path.join(research, "sampling-plan-v2.yaml"), stringify(plan), "utf8"),
    writeFile(path.join(research, "source-events-v2.yaml"), sourceEvents, "utf8"),
    writeFile(path.join(research, "sources.yaml"), legacySources, "utf8"),
  ]);
  return root;
}
