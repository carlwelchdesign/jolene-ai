import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  PersonalityTuningReviewConflictError,
  PersonalityTuningReviewNotEligibleError,
  PersonalityTuningReviewScopeError,
  PersonalityTuningReviewService,
} from "../src/application/personality-tuning-review-service.js";
import {
  RECOMMENDED_PERSONALITY_TUNING,
  personalityTuningContract,
  personalityTuningProfileSchema,
} from "../src/domain/personality-tuning.js";
import { personalityResearchDecisionSchema } from
  "../src/domain/personality-research-review.js";
import { loadPersonalityResearch } from
  "../src/personality/personality-research.js";
import { FilePersonalityResearchReviewStore } from
  "../src/persistence/file-personality-research-review-store.js";
import { FilePersonalityTuningStore } from
  "../src/persistence/file-personality-tuning-store.js";

const projectRoot = path.resolve(import.meta.dirname, "..");
const ownerScope = { actorId: "carl", workspaceId: "personal" };

describe("PersonalityTuningReviewService", () => {
  it("publishes a deterministic, strict, non-activating tuning contract", () => {
    const first = personalityTuningContract();
    const second = personalityTuningContract();

    expect(first).toMatchObject({
      schemaVersion: "jolene.personality-tuning-contract.v1",
      contractHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      activationEffect: "none",
      recommendedProfile: RECOMMENDED_PERSONALITY_TUNING,
    });
    expect(second.contractHash).toBe(first.contractHash);
    expect(personalityTuningProfileSchema.parse(RECOMMENDED_PERSONALITY_TUNING))
      .toEqual(RECOMMENDED_PERSONALITY_TUNING);
    expect(() => personalityTuningProfileSchema.parse({
      ...RECOMMENDED_PERSONALITY_TUNING,
      witIntensity: 4,
    })).toThrow();
  });

  it("requires exact owner scope and current approved research", async () => {
    const fixture = await createFixture();
    await expect(fixture.service.get({ actorId: "other", workspaceId: "personal" }))
      .rejects.toBeInstanceOf(PersonalityTuningReviewScopeError);
    await expect(fixture.service.get(ownerScope)).resolves.toMatchObject({
      reviewStatus: "blocked",
      eligibility: { eligible: false, reason: "research_unreviewed" },
    });
    const request = await validRequest();
    await expect(fixture.service.submit(request)).rejects
      .toBeInstanceOf(PersonalityTuningReviewNotEligibleError);

    await approveResearch(fixture.researchStore, "changes_requested");
    await expect(fixture.service.get(ownerScope)).resolves.toMatchObject({
      eligibility: { eligible: false, reason: "research_not_approved" },
    });
  });

  it("persists one exact tuning decision with idempotency and file permissions", async () => {
    const fixture = await createFixture();
    await approveResearch(fixture.researchStore, "approved");
    const request = await validRequest();
    const first = await fixture.service.submit(request);
    const repeated = await fixture.service.submit(request);

    expect(repeated).toEqual(first);
    expect(first).toMatchObject({
      schemaVersion: "jolene.personality-tuning-decision.v1",
      profile: RECOMMENDED_PERSONALITY_TUNING,
      reviewerId: "carl",
      workspaceId: "personal",
    });
    await expect(fixture.service.get(ownerScope)).resolves.toMatchObject({
      reviewStatus: "complete",
      eligibility: { eligible: true },
    });
    await expect(fixture.service.submit({
      ...request,
      profile: { ...request.profile, witIntensity: 2 },
    })).rejects.toBeInstanceOf(PersonalityTuningReviewConflictError);
    expect((await stat(fixture.tuningPath)).mode & 0o777).toBe(0o600);
  });

  it("serializes concurrent conflicting decisions", async () => {
    const fixture = await createFixture();
    await approveResearch(fixture.researchStore, "approved");
    const request = await validRequest();
    const results = await Promise.allSettled([
      fixture.service.submit(request),
      fixture.service.submit({
        ...request,
        profile: { ...request.profile, witIntensity: 2 },
      }),
    ]);

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(1);
    expect(results.find(({ status }) => status === "rejected")).toMatchObject({
      reason: expect.any(PersonalityTuningReviewConflictError),
    });
  });

  it("fails closed when saved tuning is stale or malformed", async () => {
    const fixture = await createFixture();
    await approveResearch(fixture.researchStore, "approved");
    await fixture.service.submit(await validRequest());
    const stored = JSON.parse(await readFile(fixture.tuningPath, "utf8"));
    stored.tuningContractHash = "a".repeat(64);
    await writeFile(fixture.tuningPath, `${JSON.stringify(stored)}\n`, "utf8");
    await expect(fixture.service.get(ownerScope)).resolves.toMatchObject({
      reviewStatus: "stale",
      decision: { tuningContractHash: "a".repeat(64) },
    });

    await writeFile(fixture.tuningPath, "{}\n", "utf8");
    await expect(fixture.service.get(ownerScope)).resolves.toMatchObject({
      reviewStatus: "decision_malformed",
      decision: null,
    });
  });
});

async function createFixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "jolene-personality-tuning-"));
  const researchPath = path.join(directory, "private", "research.json");
  const tuningPath = path.join(directory, "private", "tuning.json");
  const researchStore = new FilePersonalityResearchReviewStore(researchPath);
  const tuningStore = new FilePersonalityTuningStore(tuningPath);
  const service = new PersonalityTuningReviewService(
    () => loadPersonalityResearch(projectRoot),
    researchStore,
    tuningStore,
    ownerScope,
    () => new Date("2026-08-27T08:00:00.000Z"),
  );
  return { researchStore, tuningPath, service };
}

async function approveResearch(
  store: FilePersonalityResearchReviewStore,
  decision: "approved" | "changes_requested",
) {
  const snapshot = await loadPersonalityResearch(projectRoot);
  await store.writeDecision(personalityResearchDecisionSchema.parse({
    schemaVersion: "jolene.personality-research-decision.v1",
    snapshotHash: snapshot.snapshotHash,
    decision,
    feedback: decision === "approved" ? "" : "Revise the source mix.",
    reviewerId: ownerScope.actorId,
    workspaceId: ownerScope.workspaceId,
    reviewedAt: "2026-08-27T07:55:00.000Z",
  }));
}

async function validRequest() {
  const snapshot = await loadPersonalityResearch(projectRoot);
  return {
    ...ownerScope,
    snapshotHash: snapshot.snapshotHash,
    tuningContractHash: personalityTuningContract().contractHash,
    profile: RECOMMENDED_PERSONALITY_TUNING,
    notes: "Keep usefulness ahead of personality performance.",
  };
}
