import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { loadMemoryReviewAssets } from "../src/ui/memory-review-assets.js";

const projectRoot = resolve(import.meta.dirname, "..");
const html = readFileSync(
  resolve(projectRoot, "public/public-evaluation-review.html"),
  "utf8",
);
const css = readFileSync(
  resolve(projectRoot, "public/public-evaluation-review.css"),
  "utf8",
);
const javascript = readFileSync(
  resolve(projectRoot, "public/public-evaluation-review.js"),
  "utf8",
);
const server = readFileSync(resolve(projectRoot, "src/server.ts"), "utf8");

describe("public evaluation review UI", () => {
  it("exposes an accessible owner-only human review surface", () => {
    expect(html).toContain('href="#main"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('id="review-form"');
    expect(html).toContain("cannot run the model");
    expect(html).toContain("Human review is evidence, not launch approval");
    expect(javascript).not.toContain("innerHTML");
    expect(javascript).toContain("textContent");
    expect(javascript).toContain("public_live_review_scope_not_permitted");
    expect(css).toContain("@media (max-width: 430px)");
    expect(readFileSync(resolve(projectRoot, "public/memory-review.css"), "utf8"))
      .toContain("overflow-x: clip");
  });

  it("serves assets and same-origin-protects the decision route", () => {
    expect(server).toContain('url.pathname === "/public-evaluation"');
    expect(server).toContain('url.pathname === "/v1/public-live-model-review"');
    const route = server.indexOf(
      'url.pathname === "/v1/public-live-model-review/decision"',
    );
    expect(route).toBeGreaterThan(0);
    expect(server.slice(route, route + 500)).toContain(
      "assertSameOrigin(request.headers)",
    );
    const assets = loadMemoryReviewAssets(projectRoot);
    expect(assets.publicEvaluationHtml.body.byteLength).toBeGreaterThan(1_000);
    expect(assets.publicEvaluationCss.body.byteLength).toBeGreaterThan(1_000);
    expect(assets.publicEvaluationJavascript.body.byteLength).toBeGreaterThan(1_000);
  });

  it("links the evaluation review from every control-center page", () => {
    const pages = [
      "memory-review.html",
      "action-review.html",
      "workflow-review.html",
      "project-watch.html",
      "career-evidence.html",
      "contact-review.html",
    ];
    for (const page of pages) {
      expect(readFileSync(resolve(projectRoot, "public", page), "utf8"))
        .toContain('href="/public-evaluation"');
    }
  });
});
