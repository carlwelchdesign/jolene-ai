import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  careerRelationshipEvaluationSuiteSchema,
  evaluateCareerRelationshipSuite,
} from "../src/evaluation/career-relationship-evaluation.js";

const fixturePath = path.resolve("evaluations/career-relationship-v1.json");

describe("career relationship evaluation", () => {
  it("passes the precommitted lexical-versus-relational benchmark", async () => {
    const first = await evaluateCareerRelationshipSuite(loadFixture());
    const second = await evaluateCareerRelationshipSuite(loadFixture());

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      suiteVersion: "1.0.0",
      suiteId: "career-relationship:offline-baseline-v1",
      gate: "pass",
      counts: { cases: 3, passed: 3, failed: 0 },
      summary: {
        lexicalRecallBps: 6_111,
        relationalRecallBps: 10_000,
        relationalPrecisionBps: 10_000,
        recallImprovementBps: 3_889,
      },
    });
    expect(first.metrics).toHaveLength(6);
    expect(first.metrics.every((metric) =>
      metric.total > 0 && metric.passRateBps === 10_000 && metric.gate === "pass"
    )).toBe(true);
    expect(first.metrics.find(({ id }) => id === "relational_improvement"))
      .toMatchObject({ passed: 2, total: 2 });
  });

  it("keeps questions, evidence, relationships, and claim IDs out of reports", async () => {
    const fixture = loadFixture() as {
      cases: Array<{ query: string }>;
      claims: Array<{ id: string; proposition: string }>;
      relationships: Array<{ id: string }>;
    };
    const reportText = JSON.stringify(
      await evaluateCareerRelationshipSuite(fixture),
    );

    for (const privateBenchmarkValue of [
      fixture.cases[0]!.query,
      fixture.claims[0]!.id,
      fixture.claims[0]!.proposition,
      fixture.relationships[0]!.id,
      "unreviewed-decoy",
      "revoked-decoy",
    ]) {
      expect(reportText).not.toContain(privateBenchmarkValue);
    }
  });

  it("fails with fixed reasons when a required relationship is revoked", async () => {
    const fixture = loadFixture() as {
      relationships: Array<Record<string, unknown>>;
    };
    const index = fixture.relationships.findIndex(({ id }) =>
      id === "benchmark:relationship:teaching-translation"
    );
    fixture.relationships[index] = {
      ...fixture.relationships[index],
      state: "revoked",
    };

    const report = await evaluateCareerRelationshipSuite(fixture);

    expect(report.gate).toBe("fail");
    expect(report.cases[0]).toMatchObject({
      id: "benchmark:question:governance-to-teaching",
      status: "fail",
      failures: [
        "relational_recall_at_k:relational_recall_incomplete",
        "relational_improvement:relational_recall_did_not_improve",
      ],
    });
    expect(JSON.stringify(report)).not.toContain("Hands-on workshop");
  });

  it("fails closed for duplicate IDs, dangling references, and oversized seeds", () => {
    expect(() => careerRelationshipEvaluationSuiteSchema.parse({})).toThrow();

    const duplicate = loadFixture() as { claims: Array<Record<string, unknown>> };
    duplicate.claims[1] = { ...duplicate.claims[1], id: duplicate.claims[0]!.id };
    expect(() => careerRelationshipEvaluationSuiteSchema.parse(duplicate))
      .toThrow(/claim IDs must be unique/i);

    const dangling = loadFixture() as {
      relationships: Array<Record<string, unknown>>;
    };
    dangling.relationships[0] = {
      ...dangling.relationships[0],
      claimId: "benchmark:claim:missing-record",
    };
    expect(() => careerRelationshipEvaluationSuiteSchema.parse(dangling))
      .toThrow(/unknown claim/i);

    const mismatchedSource = loadFixture() as {
      relationships: Array<Record<string, unknown>>;
    };
    mismatchedSource.relationships[0] = {
      ...mismatchedSource.relationships[0],
      sourceId: "benchmark:source:teaching-practice",
    };
    expect(() => careerRelationshipEvaluationSuiteSchema.parse(mismatchedSource))
      .toThrow(/claim's evidence source/i);

    const oversized = loadFixture() as { cases: Array<Record<string, unknown>> };
    oversized.cases[0] = { ...oversized.cases[0], limit: 1, seedLimit: 2 };
    expect(() => careerRelationshipEvaluationSuiteSchema.parse(oversized))
      .toThrow(/seed limit/i);
  });

  it("exits nonzero without leaking content when a hard gate fails", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "jolene-relationship-eval-"));
    try {
      const fixture = loadFixture() as {
        relationships: Array<Record<string, unknown>>;
      };
      const index = fixture.relationships.findIndex(({ id }) =>
        id === "benchmark:relationship:teaching-translation"
      );
      fixture.relationships[index] = {
        ...fixture.relationships[index],
        state: "revoked",
      };
      const failedFixturePath = path.join(directory, "failed-suite.json");
      writeFileSync(failedFixturePath, JSON.stringify(fixture), "utf8");

      const result = spawnSync(
        path.resolve("node_modules/.bin/tsx"),
        ["scripts/evaluate-career-relationships.ts", failedFixturePath],
        { cwd: process.cwd(), encoding: "utf8" },
      );

      expect(result.status).toBe(1);
      expect(JSON.parse(result.stdout)).toMatchObject({ gate: "fail" });
      expect(result.stderr).toBe("");
      expect(result.stdout).not.toContain("Hands-on workshop");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

function loadFixture(): unknown {
  return structuredClone(JSON.parse(readFileSync(fixturePath, "utf8")));
}
