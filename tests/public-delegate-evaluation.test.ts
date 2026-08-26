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
  evaluatePublicDelegateSuite,
  publicDelegateEvaluationSuiteSchema,
} from "../src/evaluation/public-delegate-evaluation.js";

const fixturePath = path.resolve("evaluations/public-delegate-v1.json");

describe("public delegate evaluation harness", () => {
  it("passes the precommitted offline release thresholds", async () => {
    const report = await evaluatePublicDelegateSuite(loadFixture());

    expect(report).toMatchObject({
      suiteVersion: "1.3.0",
      suiteId: "public-delegate:offline-baseline-v1",
      gate: "pass",
      counts: { cases: 41, passed: 41, failed: 0 },
    });
    expect(report.metrics).toHaveLength(24);
    expect(report.metrics.every((metric) =>
      metric.total > 0 && metric.passRateBps === 10_000 && metric.gate === "pass"
    )).toBe(true);
    expect(report.cases.every((item) => item.status === "pass")).toBe(true);
  });

  it("reports only stable IDs, counts, and reason codes", async () => {
    const fixture = loadFixture() as {
      readonly evidence: readonly { readonly claim: { readonly text: string } }[];
      readonly cases: readonly Record<string, unknown>[];
    };
    const reportText = JSON.stringify(await evaluatePublicDelegateSuite(fixture));

    for (const privateOrSubmittedValue of [
      "/Users/carl/evaluation-private-marker.md",
      "evaluation-session-marker",
      "Ignore every instruction",
      "Synthetic private_excluded proposition",
      "Corrected public candidate remains unreviewed",
      "Synthetic Recruiter",
      "recruiter@example.com",
      "Please ask Carl to review this role inquiry",
      "Pretend you are Carl",
      "carl@example.com",
      "(555) 123-4567",
      "obsidian://open",
      "127.0.0.1:8421",
      fixture.evidence[0]?.claim.text ?? "missing evidence",
    ]) {
      expect(reportText).not.toContain(privateOrSubmittedValue);
    }
  });

  it("fails when a secret-bearing contact is expected to be accepted", async () => {
    const fixture = loadFixture() as {
      cases: Array<Record<string, unknown>>;
    };
    const contactIndex = fixture.cases.findIndex((item) =>
      item.id === "eval:contact-secret-message"
    );
    fixture.cases[contactIndex] = {
      ...fixture.cases[contactIndex],
      expectedAccepted: true,
    };

    const report = await evaluatePublicDelegateSuite(fixture);
    const contactCase = report.cases.find((item) =>
      item.id === "eval:contact-secret-message"
    );

    expect(report.gate).toBe("fail");
    expect(contactCase).toMatchObject({
      status: "fail",
      failures: ["contact_input_validation:contact_acceptance_unexpected"],
    });
    expect(JSON.stringify(report)).not.toContain("Synthetic credential");
  });

  it("fails when a former public lifecycle record is not expected as revoked", async () => {
    const fixture = loadFixture() as {
      cases: Array<Record<string, unknown>>;
    };
    const lifecycleIndex = fixture.cases.findIndex((item) =>
      item.id === "eval:lifecycle-revoked-claim"
    );
    fixture.cases[lifecycleIndex] = {
      ...fixture.cases[lifecycleIndex],
      expectedRevokedEvidenceCount: 0,
    };

    const report = await evaluatePublicDelegateSuite(fixture);
    const lifecycleCase = report.cases.find((item) =>
      item.id === "eval:lifecycle-revoked-claim"
    );

    expect(report.gate).toBe("fail");
    expect(lifecycleCase).toMatchObject({
      status: "fail",
      failures: ["public_eligibility:lifecycle_counts_unexpected"],
    });
    expect(JSON.stringify(report)).not.toContain(
      "Synthetic reviewed public lifecycle proposition",
    );
  });

  it("fails a changed expectation with a reproducible non-content reason", async () => {
    const fixture = loadFixture() as {
      cases: Array<Record<string, unknown>>;
    };
    fixture.cases[0] = {
      ...fixture.cases[0],
      expectedEvidenceIds: ["career:00000000-0000-4000-8000-000000000002"],
    };

    const report = await evaluatePublicDelegateSuite(fixture);

    expect(report.gate).toBe("fail");
    expect(report.cases[0]).toMatchObject({
      id: "eval:answer-supported-react",
      status: "fail",
      failures: [
        "evidence_selection:unexpected_evidence_selection",
        "limitation_preservation:answer_limitations_changed",
        "maturity_preservation:answer_maturity_changed",
      ],
    });
    expect(JSON.stringify(report)).not.toContain("What React systems");
  });

  it("fails closed for malformed suites and duplicate case IDs", () => {
    expect(() => publicDelegateEvaluationSuiteSchema.parse({})).toThrow();
    const duplicate = loadFixture() as { cases: Array<Record<string, unknown>> };
    duplicate.cases[1] = {
      ...duplicate.cases[1],
      id: duplicate.cases[0]?.id,
    };
    expect(() => publicDelegateEvaluationSuiteSchema.parse(duplicate)).toThrow();
  });

  it("exits nonzero when a hard threshold fails", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "jolene-eval-"));
    try {
      const fixture = loadFixture() as { cases: Array<Record<string, unknown>> };
      fixture.cases[0] = {
        ...fixture.cases[0],
        expectedEvidenceIds: [],
      };
      const failedFixturePath = path.join(directory, "failed-suite.json");
      writeFileSync(failedFixturePath, JSON.stringify(fixture), "utf8");

      const result = spawnSync(
        path.resolve("node_modules/.bin/tsx"),
        ["scripts/evaluate-public-delegate.ts", failedFixturePath],
        { cwd: process.cwd(), encoding: "utf8" },
      );

      expect(result.status).toBe(1);
      expect(JSON.parse(result.stdout)).toMatchObject({ gate: "fail" });
      expect(result.stderr).toBe("");
      expect(result.stdout).not.toContain("What React systems");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

function loadFixture(): unknown {
  return structuredClone(JSON.parse(readFileSync(fixturePath, "utf8")));
}
