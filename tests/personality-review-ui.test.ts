import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { loadMemoryReviewAssets } from "../src/ui/memory-review-assets.js";

const projectRoot = resolve(import.meta.dirname, "..");
const html = readFileSync(resolve(projectRoot, "public/personality-review.html"), "utf8");
const css = readFileSync(resolve(projectRoot, "public/personality-review.css"), "utf8");
const javascript = readFileSync(resolve(projectRoot, "public/personality-review.js"), "utf8");
const server = readFileSync(resolve(projectRoot, "src/server.ts"), "utf8");

describe("personality research review UI", () => {
  it("makes the research gate and non-activation boundary explicit", () => {
    expect(html).toContain('href="#main"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('id="decision-form"');
    expect(html).toContain("Relevance approval is not personality activation");
    expect(html).toContain("cannot change Jolene’s prompt or behavior");
    expect(html).toContain('id="tuning-form"');
    expect(html).toContain("Saving records a local decision only");
    expect(html).toContain("Purpose-limited task packets only");
    expect(javascript).not.toContain("innerHTML");
    expect(javascript).toContain("textContent");
    expect(javascript).toContain("personality_review_scope_not_permitted");
    expect(javascript).toContain("personality_tuning_not_eligible");
    expect(css).toContain("@media (max-width:430px)");
    expect(css).toContain(".decision-panel form[hidden]");
  });

  it("serves immutable assets and same-origin protects the decision route", () => {
    expect(server).toContain('url.pathname === "/personality-review"');
    expect(server).toContain('url.pathname === "/v1/personality-research-review"');
    const route = server.indexOf(
      'url.pathname === "/v1/personality-research-review/decision"',
    );
    expect(route).toBeGreaterThan(0);
    expect(server.slice(route, route + 500)).toContain("assertSameOrigin(request.headers)");
    const tuningRoute = server.indexOf(
      'url.pathname === "/v1/personality-tuning-review/decision"',
    );
    expect(tuningRoute).toBeGreaterThan(0);
    expect(server.slice(tuningRoute, tuningRoute + 500))
      .toContain("assertSameOrigin(request.headers)");
    const assets = loadMemoryReviewAssets(projectRoot);
    expect(assets.personalityHtml.body.byteLength).toBeGreaterThan(1_000);
    expect(assets.personalityCss.body.byteLength).toBeGreaterThan(1_000);
    expect(assets.personalityJavascript.body.byteLength).toBeGreaterThan(1_000);
  });

  it("links personality research from every control-center page", () => {
    for (const page of [
      "memory-review.html", "action-review.html", "workflow-review.html",
      "project-watch.html", "career-evidence.html", "contact-review.html",
      "public-evaluation-review.html", "client-ai-review.html",
    ]) {
      expect(readFileSync(resolve(projectRoot, "public", page), "utf8"))
        .toContain('href="/personality-review"');
    }
  });
});
