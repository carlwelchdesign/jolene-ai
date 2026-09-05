import { describe, expect, it } from "vitest";

import suite from "../evaluations/public-role-advocacy-v1.json" with { type: "json" };
import { createPublicEvidenceArtifact } from "./helpers/public-evidence-fixture.js";
import {
  evaluatePublicRoleAdvocacySuite,
  publicRoleAdvocacySuiteSchema,
} from "../src/evaluation/public-role-advocacy-evaluation.js";

describe("public role advocacy suite", () => {
  it("keeps sixteen representative role comparisons sales-first", () => {
    expect(publicRoleAdvocacySuiteSchema.parse(suite).cases).toHaveLength(16);
    const report = evaluatePublicRoleAdvocacySuite(
      suite,
      createPublicEvidenceArtifact(),
    );

    expect(report).toMatchObject({
      suiteId: "public-role-advocacy:sales-first-v1",
      passed: true,
    });
    expect(report.cases).toHaveLength(16);
    expect(report.cases.every((item) => item.passed)).toBe(true);
  });
});
