import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadMemoryReviewAssets } from "../src/ui/memory-review-assets.js";

const root = resolve(import.meta.dirname, "..");
const html = readFileSync(resolve(root, "public/conversation-evaluation-review.html"), "utf8");
const css = readFileSync(resolve(root, "public/conversation-evaluation-review.css"), "utf8");
const javascript = readFileSync(resolve(root, "public/conversation-evaluation-review.js"), "utf8");
const server = readFileSync(resolve(root, "src/server.ts"), "utf8");

describe("conversation evaluation review UI", () => {
  it("renders an accessible local-only seven-dimension human gate", () => {
    expect(html).toContain('href="#main"');
    expect(html).toContain("Private review, not deployment approval");
    expect(html).toContain("cannot call a model, deploy, publish, contact anyone");
    for (const dimension of ["taskSuccess", "evidenceTransparency", "warmthKindness", "witRestraint", "agencyBoundaries", "situationalCalibration", "originality"]) expect(javascript).toContain(dimension);
    for (const failure of ["canned_pr_language", "private_disclosure", "conversation_continuity_lost"]) expect(javascript).toContain(failure);
    expect(javascript).not.toContain("innerHTML");
    expect(css).toContain("@media (max-width: 430px)");
  });

  it("serves all assets and same-origin protects decisions", () => {
    expect(server).toContain('url.pathname === "/conversation-evaluation"');
    const route = server.indexOf('url.pathname === "/v1/conversation-quality-review/decision"');
    expect(route).toBeGreaterThan(0);
    expect(server.slice(route, route + 500)).toContain("assertSameOrigin(request.headers)");
    const assets = loadMemoryReviewAssets(root);
    expect(assets.conversationEvaluationHtml.body.byteLength).toBeGreaterThan(1_000);
    expect(assets.conversationEvaluationCss.body.byteLength).toBeGreaterThan(1_000);
    expect(assets.conversationEvaluationJavascript.body.byteLength).toBeGreaterThan(1_000);
  });
});
