import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  ConversationalQualityReviewConflictError,
  ConversationalQualityReviewIncompleteError,
  ConversationalQualityReviewScopeError,
  ConversationalQualityReviewService,
} from "../src/application/conversational-quality-review-service.js";
import { FileConversationalQualityReviewStore } from
  "../src/persistence/file-conversational-quality-review-store.js";

const ownerScope = { actorId: "carl", workspaceId: "personal" };
const caseIds = [
  ["recruiter", "private_chat"], ["skeptical", "portfolio"],
  ["project_exploration", "portfolio"], ["personal_private", "slack_dm"],
  ["recipe", "private_chat"], ["grief_high_stakes", "private_chat"],
  ["refusal", "slack_shared"], ["follow_up", "portfolio"], ["continuity", "private_chat"],
] as const;

describe("ConversationalQualityReviewService", () => {
  it("reports unavailable packets and exposes criteria without model calls", async () => {
    const paths = await reviewPaths();
    const snapshot = await createService(paths).get(ownerScope);
    expect(snapshot).toMatchObject({ packetStatus: "missing", reviewStatus: "unavailable", packet: null });
    expect(snapshot.criteria).toHaveLength(9);
  });

  it("requires the exact owner scope", async () => {
    const paths = await reviewPaths(); await writePacket(paths.packetPath, packet());
    await expect(createService(paths).get({ actorId: "other", workspaceId: "personal" }))
      .rejects.toBeInstanceOf(ConversationalQualityReviewScopeError);
  });

  it("persists a 0600 hash-bound decision and detects a stale capture", async () => {
    const paths = await reviewPaths(); await writePacket(paths.packetPath, packet());
    const service = createService(paths); const snapshot = await service.get(ownerScope);
    const decision = await service.submit(submission(snapshot.packetHash!));
    expect(decision).toMatchObject({ overall: "approved", report: { gate: "pass" }, reviewer: "carl" });
    expect((await stat(paths.decisionPath)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(paths.decisionPath, "utf8"))).toEqual(decision);
    const changed = packet(); changed.capturedAt = "2026-08-27T20:00:00.000Z"; await writePacket(paths.packetPath, changed);
    await expect(service.get(ownerScope)).resolves.toMatchObject({ reviewStatus: "stale" });
    await expect(service.submit(submission(snapshot.packetHash!))).rejects.toBeInstanceOf(ConversationalQualityReviewConflictError);
  });

  it("rejects incomplete case coverage and incoherent approval", async () => {
    const paths = await reviewPaths(); await writePacket(paths.packetPath, packet());
    const service = createService(paths); const hash = (await service.get(ownerScope)).packetHash!;
    const input = submission(hash);
    await expect(service.submit({ ...input, reviews: input.reviews.slice(1) })).rejects.toBeInstanceOf(ConversationalQualityReviewIncompleteError);
    const failed = { ...input.reviews[0], reviewerHardFailures: ["private_disclosure"] };
    await expect(service.submit({ ...input, reviews: [failed, ...input.reviews.slice(1)] })).rejects.toBeInstanceOf(ConversationalQualityReviewIncompleteError);
  });
});

function suite() {
  return { suiteVersion: "1.0.0", suiteId: "conversation-quality:test", thresholds: { minimumWeightedMean: 3, minimumOriginalityPerCase: 3 }, cases: caseIds.map(([category, channel], index) => ({ id: `conversation:test-${index}`, category, prompt: `Prompt ${index}`, channel, requiresEvidence: false, expectedBehaviors: ["Be useful."] })) };
}
function packet() {
  return { suiteVersion: "1.0.0" as const, suiteId: "conversation-quality:test", capturedAt: "2026-08-27T19:00:00.000Z", model: "gpt-test", humanReview: "required" as const, cases: suite().cases.map((item) => ({ id: item.id, category: item.category, prompt: item.prompt, channel: item.channel, answer: "A specific, warm, grounded answer.", citations: [], followUps: [], mode: "model" as const })) };
}
function submission(packetHash: string) {
  return { ...ownerScope, packetHash, overall: "approved" as const, reviews: packet().cases.map((item) => ({ caseId: item.id, answer: item.answer, citations: item.citations, followUps: item.followUps, scores: { taskSuccess: 4, evidenceTransparency: 4, warmthKindness: 4, witRestraint: 4, agencyBoundaries: 4, situationalCalibration: 4, originality: 4 }, reviewerHardFailures: [], notes: "Reviewed." })) };
}
function createService(paths: Awaited<ReturnType<typeof reviewPaths>>) { return new ConversationalQualityReviewService(new FileConversationalQualityReviewStore(paths.packetPath, paths.decisionPath), suite(), ownerScope, () => new Date("2026-08-27T21:00:00.000Z")); }
async function reviewPaths() { const directory = await mkdtemp(path.join(tmpdir(), "jolene-quality-review-")); return { packetPath: path.join(directory, "packet.json"), decisionPath: path.join(directory, "decision", "decision.json") }; }
async function writePacket(filePath: string, value: ReturnType<typeof packet>) { await mkdir(path.dirname(filePath), { recursive: true }); await writeFile(filePath, `${JSON.stringify(value)}\n`, { mode: 0o600 }); }
