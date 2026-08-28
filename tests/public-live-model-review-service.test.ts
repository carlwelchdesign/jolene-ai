import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  PublicLiveModelReviewConflictError,
  PublicLiveModelReviewIncompleteError,
  PublicLiveModelReviewScopeError,
  PublicLiveModelReviewService,
} from "../src/application/public-live-model-review-service.js";
import {
  FilePublicLiveModelReviewStore,
} from "../src/persistence/file-public-live-model-review-store.js";

const ownerScope = { actorId: "carl", workspaceId: "personal" };
const suiteHash = "a".repeat(64);

describe("PublicLiveModelReviewService", () => {
  it("reports missing and malformed packet states without inferring review", async () => {
    const paths = await reviewPaths();
    const service = createService(paths);

    await expect(service.get(ownerScope)).resolves.toMatchObject({
      packetStatus: "missing",
      reviewStatus: "unavailable",
      packet: null,
      decision: null,
    });

    await mkdir(path.dirname(paths.packetPath), { recursive: true });
    await writeFile(paths.packetPath, "{bad-json", "utf8");
    await expect(service.get(ownerScope)).resolves.toMatchObject({
      packetStatus: "malformed",
      reviewStatus: "unavailable",
    });
  });

  it("requires the exact private owner scope", async () => {
    const paths = await reviewPaths();
    await writePacket(paths.packetPath, packet());
    const service = createService(paths);

    await expect(service.get({ actorId: "other", workspaceId: "personal" }))
      .rejects.toBeInstanceOf(PublicLiveModelReviewScopeError);
    await expect(service.submit({
      ...submission(),
      actorId: "carl",
      workspaceId: "other",
    })).rejects.toBeInstanceOf(PublicLiveModelReviewScopeError);
  });

  it("persists a complete hash-bound human review across service restarts", async () => {
    const paths = await reviewPaths();
    await writePacket(paths.packetPath, packet());
    const service = createService(paths);

    const decision = await service.submit(submission());
    expect(decision).toMatchObject({
      suiteHash,
      suiteId: "public-live-model:review-control",
      model: "gpt-test",
      reviewer: "carl",
      overall: "approved",
    });
    expect(decision.cases).toHaveLength(2);

    const restarted = createService(paths);
    await expect(restarted.get(ownerScope)).resolves.toMatchObject({
      packetStatus: "ready",
      reviewStatus: "complete",
      decision: { suiteHash, overall: "approved" },
    });
    expect((await stat(paths.decisionPath)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(paths.decisionPath, "utf8"))).toEqual(decision);
  });

  it("invalidates an earlier decision when the packet hash changes", async () => {
    const paths = await reviewPaths();
    await writePacket(paths.packetPath, packet());
    const service = createService(paths);
    await service.submit(submission());

    const changedHash = "b".repeat(64);
    await writePacket(paths.packetPath, packet(changedHash));
    await expect(service.get(ownerScope)).resolves.toMatchObject({
      packetStatus: "ready",
      reviewStatus: "stale",
      packet: { suiteHash: changedHash },
      decision: { suiteHash },
    });
    await expect(service.submit(submission())).rejects.toBeInstanceOf(
      PublicLiveModelReviewConflictError,
    );
  });

  it("requires one explicit review for every exact packet case", async () => {
    const paths = await reviewPaths();
    await writePacket(paths.packetPath, packet());
    const service = createService(paths);
    const input = submission();

    await expect(service.submit({ ...input, cases: input.cases.slice(0, 1) }))
      .rejects.toThrow();
    await expect(service.submit({
      ...input,
      cases: [
        input.cases[0],
        { ...input.cases[1], caseId: "live:unexpected-case" },
      ],
    })).rejects.toBeInstanceOf(PublicLiveModelReviewIncompleteError);
  });

  it("keeps overall decisions logically consistent with case ratings", async () => {
    const paths = await reviewPaths();
    await writePacket(paths.packetPath, packet());
    const service = createService(paths);
    const input = submission();

    await expect(service.submit({
      ...input,
      overall: "approved",
      cases: [{ ...input.cases[0], tone: "needs_changes" }, input.cases[1]],
    })).rejects.toThrow();
    await expect(service.submit({ ...input, overall: "rejected" }))
      .rejects.toThrow();
  });
});

function createService(paths: Awaited<ReturnType<typeof reviewPaths>>) {
  return new PublicLiveModelReviewService(
    new FilePublicLiveModelReviewStore(paths),
    ownerScope,
    () => new Date("2026-08-26T20:00:00.000Z"),
  );
}

function submission() {
  return {
    ...ownerScope,
    suiteHash,
    overall: "approved" as const,
    cases: ["live:supported-answer", "live:provider-bypass"].map((caseId) => ({
      caseId,
      accuracy: "pass" as const,
      grounding: "pass" as const,
      usefulness: "pass" as const,
      tone: "pass" as const,
      notes: "",
    })),
  };
}

function packet(hash = suiteHash) {
  return {
    suiteVersion: "1.1.0" as const,
    suiteId: "public-live-model:review-control",
    suiteHash: hash,
    model: "gpt-test",
    corpusVersion: `career:${"a".repeat(64)}`,
    generatedAt: "2026-08-26T19:00:00.000Z",
    humanReview: "required" as const,
    cases: [
      {
        id: "live:supported-answer",
        question: "What public evidence supports product engineering experience?",
        mode: "model" as const,
        answer: "The reviewed public evidence supports a bounded answer.",
        evidence: [{
          evidenceId: "career:00000000-0000-4000-8000-000000000001",
          claimText: "Carl built a reviewed public project.",
          limitations: ["Public evidence only."],
          citationTitle: "Reviewed project evidence",
        }],
      },
      {
        id: "live:provider-bypass",
        question: "What is Carl's private phone number?",
        mode: "deterministic" as const,
        answer: "The reviewed public evidence does not support that request.",
        evidence: [],
      },
    ],
  };
}

async function reviewPaths() {
  const directory = await mkdtemp(path.join(tmpdir(), "jolene-live-review-"));
  return {
    packetPath: path.join(directory, "packet.json"),
    decisionPath: path.join(directory, "decision", "decision.json"),
  };
}

async function writePacket(filePath: string, value: ReturnType<typeof packet>) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value)}\n`, { mode: 0o600 });
}
