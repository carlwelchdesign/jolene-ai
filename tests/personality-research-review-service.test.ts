import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  PersonalityResearchReviewConflictError,
  PersonalityResearchReviewScopeError,
  PersonalityResearchReviewService,
} from "../src/application/personality-research-review-service.js";
import { loadPersonalityResearch } from
  "../src/personality/personality-research.js";
import { FilePersonalityResearchReviewStore } from
  "../src/persistence/file-personality-research-review-store.js";

const projectRoot = path.resolve(import.meta.dirname, "..");
const ownerScope = { actorId: "carl", workspaceId: "personal" };

describe("PersonalityResearchReviewService", () => {
  it("loads a rights-conscious snapshot with deterministic artifact fingerprints", async () => {
    const first = await loadPersonalityResearch(projectRoot);
    const second = await loadPersonalityResearch(projectRoot);

    expect(first).toMatchObject({
      schemaVersion: "jolene.personality-research-snapshot.v1",
      registeredSources: 11,
      observations: 25,
      codedSources: 5,
      independentlyReviewed: 7,
      rightsPolicy: {
        repositoryStorage: "metadata-and-paraphrase-only",
        transcriptStorage: "prohibited",
        lyricsStorage: "prohibited",
      },
    });
    expect(first.snapshotHash).toMatch(/^[a-f0-9]{64}$/);
    expect(second.snapshotHash).toBe(first.snapshotHash);
    expect(first.artifacts).toHaveLength(5);
    expect(first.codedObservations.every((item) =>
      item.excerpt_under_25_words === null
    )).toBe(true);
  });

  it("requires exact owner scope and feedback for non-approval decisions", async () => {
    const fixture = await createFixture();
    await expect(fixture.service.get({ actorId: "other", workspaceId: "personal" }))
      .rejects.toBeInstanceOf(PersonalityResearchReviewScopeError);
    const snapshot = await loadPersonalityResearch(projectRoot);
    await expect(fixture.service.submit({
      ...ownerScope,
      snapshotHash: snapshot.snapshotHash,
      decision: "changes_requested",
      feedback: "",
    })).rejects.toThrow(/feedback/i);
  });

  it("persists an exact decision, makes repeats idempotent, and rejects conflicts", async () => {
    const fixture = await createFixture();
    const snapshot = await loadPersonalityResearch(projectRoot);
    const request = {
      ...ownerScope,
      snapshotHash: snapshot.snapshotHash,
      decision: "approved" as const,
      feedback: "Kind, direct, practical, and never an impersonation.",
    };
    const first = await fixture.service.submit(request);
    const repeated = await fixture.service.submit(request);
    expect(repeated).toEqual(first);
    await expect(fixture.service.submit({ ...request, decision: "rejected" }))
      .rejects.toBeInstanceOf(PersonalityResearchReviewConflictError);

    const restarted = createService(fixture.decisionPath);
    await expect(restarted.get(ownerScope)).resolves.toMatchObject({
      reviewStatus: "complete",
      decision: { snapshotHash: snapshot.snapshotHash, decision: "approved" },
    });
    expect((await stat(fixture.decisionPath)).mode & 0o777).toBe(0o600);
  });

  it("marks a saved decision stale when any reviewed artifact changes", async () => {
    const fixture = await createFixture();
    const snapshot = await loadPersonalityResearch(projectRoot);
    await fixture.service.submit({
      ...ownerScope,
      snapshotHash: snapshot.snapshotHash,
      decision: "approved",
      feedback: "",
    });
    const stored = JSON.parse(await readFile(fixture.decisionPath, "utf8"));
    stored.snapshotHash = "b".repeat(64);
    await writeFile(fixture.decisionPath, `${JSON.stringify(stored)}\n`, "utf8");

    await expect(createService(fixture.decisionPath).get(ownerScope)).resolves
      .toMatchObject({ reviewStatus: "stale", decision: { snapshotHash: "b".repeat(64) } });
  });
});

async function createFixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "jolene-personality-review-"));
  const decisionPath = path.join(directory, "private", "decision.json");
  return { decisionPath, service: createService(decisionPath) };
}

function createService(decisionPath: string) {
  return new PersonalityResearchReviewService(
    () => loadPersonalityResearch(projectRoot),
    new FilePersonalityResearchReviewStore(decisionPath),
    ownerScope,
    () => new Date("2026-08-26T22:00:00.000Z"),
  );
}
