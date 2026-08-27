import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { parse, stringify } from "yaml";
import { describe, expect, it } from "vitest";

import { validatePersonalitySamplingPlan } from
  "../scripts/validate-personality-sampling-plan.js";
import { loadPersonalitySamplingPlanV2 } from
  "../src/personality/personality-sampling-plan.js";
import { loadPersonalitySamplingOutcomeV2 } from
  "../src/personality/personality-sampling-plan.js";
import type { PersonalitySamplingPlan } from
  "../src/personality/personality-sampling-plan.js";

describe("personality sampling plan v2", () => {
  it("freezes a balanced 120-turn plan before primary coding", async () => {
    await expect(validatePersonalitySamplingPlan()).resolves.toMatchObject({
      schemaVersion: "jolene.personality-sampling-plan.v2",
      planFingerprint: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      sourceRegisterState: "superseded-after-recorded-failure",
      targetAtomicTurns: 120,
      systematicTurns: 96,
      purposiveHighRiskTurns: 24,
      sourceEvents: 11,
      historicalDiversityMetricsRecomputed: false,
      runtimeActivation: "prohibited",
      outcome: {
        status: "failed-before-selection-and-coding",
        failureCode: "explicit-speaker-attribution-unavailable",
        failureSourceId: "S10",
        boundaryUnitsReviewed: 380,
        explicitlyAttributedTargetTurns: 0,
        observationsCreated: 0,
        replacementOrResamplingPerformed: false,
      },
    });
  });

  it("keeps the superseded plan unavailable to the current-plan loader", async () => {
    await expect(loadPersonalitySamplingPlanV2())
      .rejects.toThrow("Sampling plan source-register snapshot is stale");
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
    }, true);
    await expect(validatePersonalitySamplingPlan(root))
      .rejects.toThrow("Invalid target turn allocation");
  });

  it("rejects a failure outcome for a different frozen plan", async () => {
    const root = await outcomeFixtureRoot((outcome) => {
      outcome.sampling_plan_fingerprint = `sha256:${"0".repeat(64)}`;
    });
    await expect(loadPersonalitySamplingOutcomeV2(root))
      .rejects.toThrow("Sampling outcome does not match the frozen plan snapshot");
  });

  it("rejects a failure outcome recorded before the plan was frozen", async () => {
    const root = await outcomeFixtureRoot((outcome) => {
      outcome.evaluated_at = "2026-08-27T08:59:59Z";
    });
    await expect(loadPersonalitySamplingOutcomeV2(root))
      .rejects.toThrow("Sampling outcome predates the frozen plan");
  });
});

async function fixtureRoot(
  change: (plan: PersonalitySamplingPlan) => void,
  withMatchingFailureOutcome = false,
): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "jolene-sampling-plan-"));
  const research = path.join(root, "research");
  await mkdir(research);
  const projectRoot = process.cwd();
  const [planText, outcomeText, sourceEvents, legacySources] = await Promise.all([
    readFile(path.join(projectRoot, "research", "sampling-plan-v2.yaml"), "utf8"),
    readFile(path.join(projectRoot, "research", "sampling-plan-v2-outcome.yaml"), "utf8"),
    readFile(path.join(projectRoot, "research", "source-events-v2.yaml"), "utf8"),
    readFile(path.join(projectRoot, "research", "sources.yaml"), "utf8"),
  ]);
  const plan = parse(planText) as PersonalitySamplingPlan;
  change(plan);
  const changedPlanText = stringify(plan);
  const writes = [
    writeFile(path.join(research, "sampling-plan-v2.yaml"), changedPlanText, "utf8"),
    writeFile(path.join(research, "source-events-v2.yaml"), sourceEvents, "utf8"),
    writeFile(path.join(research, "sources.yaml"), legacySources, "utf8"),
  ];
  if (withMatchingFailureOutcome) {
    const outcome = parse(outcomeText) as OutcomeFixture;
    outcome.sampling_plan_fingerprint = `sha256:${createHash("sha256")
      .update(changedPlanText, "utf8").digest("hex")}`;
    outcome.source_register_fingerprint = plan.source_register.fingerprint;
    writes.push(writeFile(
      path.join(research, "sampling-plan-v2-outcome.yaml"), stringify(outcome), "utf8",
    ));
  }
  await Promise.all(writes);
  return root;
}

interface OutcomeFixture {
  evaluated_at: string;
  sampling_plan_fingerprint: string;
  source_register_fingerprint: string;
}

async function outcomeFixtureRoot(change: (outcome: OutcomeFixture) => void): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "jolene-sampling-outcome-"));
  const research = path.join(root, "research");
  await mkdir(research);
  const projectRoot = process.cwd();
  const [planText, outcomeText, sourceEvents, legacySources] = await Promise.all([
    readFile(path.join(projectRoot, "research", "sampling-plan-v2.yaml"), "utf8"),
    readFile(path.join(projectRoot, "research", "sampling-plan-v2-outcome.yaml"), "utf8"),
    readFile(path.join(projectRoot, "research", "source-events-v2.yaml"), "utf8"),
    readFile(path.join(projectRoot, "research", "sources.yaml"), "utf8"),
  ]);
  const outcome = parse(outcomeText) as OutcomeFixture;
  change(outcome);
  await Promise.all([
    writeFile(path.join(research, "sampling-plan-v2.yaml"), planText, "utf8"),
    writeFile(path.join(research, "sampling-plan-v2-outcome.yaml"), stringify(outcome), "utf8"),
    writeFile(path.join(research, "source-events-v2.yaml"), sourceEvents, "utf8"),
    writeFile(path.join(research, "sources.yaml"), legacySources, "utf8"),
  ]);
  return root;
}
