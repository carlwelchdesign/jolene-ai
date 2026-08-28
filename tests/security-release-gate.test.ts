import { describe, expect, it } from "vitest";

import { evaluateSecurityRelease } from "../src/security/security-release-gate.js";

const now = "2026-08-27T21:00:00.000-07:00";
const hash = "a".repeat(64);

describe("security release gate", () => {
  it("passes only when every evidence class is current, passing, and hash-matched", () => {
    const result = evaluateSecurityRelease(packet([
      present("deterministic"),
      present("live_model"),
      present("privacy"),
      present("owner_approval"),
      present("deployment"),
    ]), now);
    expect(result).toMatchObject({ status: "passed", blockers: [] });
  });

  it("blocks missing, failed, changed, and stale evidence independently", () => {
    const result = evaluateSecurityRelease(packet([
      { evidenceClass: "deterministic", status: "missing" },
      { ...present("live_model"), status: "failed" },
      { ...present("privacy"), subjectHash: "b".repeat(64) },
      { ...present("owner_approval"), expiresAt: now },
      present("deployment"),
    ]), now);
    expect(result).toMatchObject({
      status: "blocked",
      blockers: [
        { evidenceClass: "deterministic", reason: "missing" },
        { evidenceClass: "live_model", reason: "failed" },
        { evidenceClass: "privacy", reason: "changed" },
        { evidenceClass: "owner_approval", reason: "stale" },
      ],
    });
  });

  it("rejects duplicate, omitted, unknown, and future-dated evidence", () => {
    expect(() => evaluateSecurityRelease(packet([
      present("deterministic"),
      present("deterministic"),
      present("privacy"),
      present("owner_approval"),
      present("deployment"),
    ]), now)).toThrow("each required class exactly once");

    expect(() => evaluateSecurityRelease(packet([
      present("deterministic"),
      present("live_model"),
      present("privacy"),
      present("owner_approval"),
      { ...present("deployment"), observedAt: "2026-08-28T21:00:00.000-07:00" },
    ]), now)).toThrow("cannot be observed in the future");
  });
});

function packet(evidence: unknown[]) {
  return {
    schemaVersion: "jolene.security-release-evidence.v1",
    releaseId: `release:${"0".repeat(32)}`,
    evidence,
  };
}

function present(evidenceClass: string) {
  return {
    evidenceClass,
    status: "passed",
    observedAt: "2026-08-27T20:00:00.000-07:00",
    expiresAt: "2026-08-28T21:00:00.000-07:00",
    subjectHash: hash,
    expectedSubjectHash: hash,
  };
}
