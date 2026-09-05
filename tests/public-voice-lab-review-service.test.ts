import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  PublicVoiceLabReviewConflictError,
  PublicVoiceLabReviewIncompleteError,
  PublicVoiceLabReviewScopeError,
  PublicVoiceLabReviewService,
} from "../src/application/public-voice-lab-review-service.js";
import { FilePublicVoiceLabReviewStore } from "../src/persistence/file-public-voice-lab-review-store.js";

const scope = { actorId: "carl", workspaceId: "personal" };
const dimensions = ["grounding", "usefulness", "originality", "emotional_calibration", "conversational_aliveness", "restraint"] as const;
const ids = Array.from({ length: 30 }, (_, index) => `voice:case-${index}`);

describe("PublicVoiceLabReviewService", () => {
  it("is owner-scoped and treats a missing private capture as unavailable", async () => {
    const paths = await pathsFor(); const service = createService(paths);
    await expect(service.get({ actorId: "other", workspaceId: "personal" })).rejects.toBeInstanceOf(PublicVoiceLabReviewScopeError);
    await expect(service.get(scope)).resolves.toMatchObject({ packetStatus: "missing", reviewStatus: "unavailable" });
  });

  it("writes a 0600 decision for exactly the captured packet", async () => {
    const paths = await pathsFor(); await writePacket(paths.packet, packet()); const service = createService(paths);
    const snapshot = await service.get(scope); const decision = await service.submit(submission(snapshot.packetHash!));
    expect(decision).toMatchObject({ overall: "approved", reviewer: "carl" });
    expect((await stat(paths.decision)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(paths.decision, "utf8"))).toEqual(decision);
    const changed = packet(); changed.capturedAt = "2026-09-05T00:00:00.000Z"; await writePacket(paths.packet, changed);
    await expect(service.submit(submission(snapshot.packetHash!))).rejects.toBeInstanceOf(PublicVoiceLabReviewConflictError);
  });

  it("blocks approval with missing cases or weak scores", async () => {
    const paths = await pathsFor(); await writePacket(paths.packet, packet()); const service = createService(paths); const hash = (await service.get(scope)).packetHash!;
    const input = submission(hash);
    await expect(service.submit({ ...input, reviews: input.reviews.slice(1) })).rejects.toBeInstanceOf(PublicVoiceLabReviewIncompleteError);
    const weak = { ...input.reviews[0], scores: { ...input.reviews[0]!.scores, originality: 2 } };
    await expect(service.submit({ ...input, reviews: [weak, ...input.reviews.slice(1)] })).rejects.toBeInstanceOf(PublicVoiceLabReviewIncompleteError);
  });
});

function suite() { return { suiteVersion: "1.0.0" as const, suiteId: "public-voice-lab:original-character-v1" as const, ownerOnly: true as const, humanReviewRequired: true as const, reviewDimensions: [...dimensions], cases: ids.map((id) => ({ id, prompt: "A useful question", register: "explanation" as const, expectedMoves: ["Be useful"] })) }; }
function packet() { return { suiteVersion: "1.0.0" as const, suiteId: "public-voice-lab:original-character-v1" as const, capturedAt: "2026-09-04T00:00:00.000Z", model: "gpt-test", ownerOnly: true as const, humanReviewRequired: true as const, cases: ids.map((id) => ({ id, prompt: "A useful question", register: "explanation" as const, mode: "model" as const, answer: "A useful answer.", citationIds: [] })) }; }
function submission(packetHash: string) { return { ...scope, packetHash, overall: "approved" as const, reviews: ids.map((caseId) => ({ caseId, outcome: "approved" as const, scores: Object.fromEntries(dimensions.map((dimension) => [dimension, 4])), notes: "Reviewed." })) }; }
function createService(paths: Awaited<ReturnType<typeof pathsFor>>) { return new PublicVoiceLabReviewService(new FilePublicVoiceLabReviewStore(paths.packet, paths.decision), suite(), scope, () => new Date("2026-09-04T01:00:00.000Z")); }
async function pathsFor() { const directory = await mkdtemp(path.join(tmpdir(), "jolene-voice-review-")); return { packet: path.join(directory, "packet.json"), decision: path.join(directory, "decision", "decision.json") }; }
async function writePacket(filePath: string, value: ReturnType<typeof packet>) { await mkdir(path.dirname(filePath), { recursive: true }); await writeFile(filePath, `${JSON.stringify(value)}\n`, { mode: 0o600 }); }
