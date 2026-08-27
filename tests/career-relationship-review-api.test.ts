import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const projectRoot = resolve(import.meta.dirname, "..");
const server = readFileSync(resolve(projectRoot, "src/server.ts"), "utf8");

describe("owner-reviewed career relationship API", () => {
  it("exposes scoped candidates and durable review history", () => {
    expect(server).toContain('url.pathname === "/v1/career-evidence/relationship-candidates"');
    expect(server).toContain("application.careerEvidence.listRelationshipCandidates(scopeFrom(url))");
    expect(server).toContain('url.pathname === "/v1/career-evidence/relationship-reviews"');
    expect(server).toContain("application.careerEvidence.listRelationshipReviews(scopeFrom(url))");
  });

  it("same-origin protects exact candidate decisions", () => {
    const route = "relationshipCandidateDecisionMatch?.[1]";
    const start = server.indexOf(route);
    expect(start).toBeGreaterThan(-1);
    expect(server.slice(start, start + 700)).toContain("assertSameOrigin(request.headers)");
    expect(server.slice(start, start + 700)).toContain("decideRelationshipCandidate");
  });
});
