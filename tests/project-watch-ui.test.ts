import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { loadMemoryReviewAssets } from "../src/ui/memory-review-assets.js";

const projectRoot = resolve(import.meta.dirname, "..");
const html = readFileSync(resolve(projectRoot, "public/project-watch.html"), "utf8");
const css = readFileSync(resolve(projectRoot, "public/project-watch.css"), "utf8");
const sharedCss = readFileSync(resolve(projectRoot, "public/memory-review.css"), "utf8");
const javascript = readFileSync(resolve(projectRoot, "public/project-watch.js"), "utf8");
const server = readFileSync(resolve(projectRoot, "src/server.ts"), "utf8");

describe("Project Watch interface", () => {
  it("makes the read-only and bounded-monitoring boundaries persistent", () => {
    expect(html).toContain("Jolene only looks at project state.");
    expect(html).toContain("Owner alerts on state changes only");
    expect(html).toContain("never a shared channel or arbitrary destination");
    expect(javascript).toContain('method: "POST"');
    expect(javascript).not.toMatch(/method:\s*["'](?:PUT|PATCH|DELETE)/);
    expect(javascript).not.toMatch(/\/v1\/(?:action-proposals|workflows|tasks)/);
  });

  it("provides accessible loading, status, refresh, and error regions", () => {
    expect(html).toContain('<a class="skip-link" href="#main">');
    expect(html).toContain('<main id="main">');
    expect(html).toContain('aria-label="Project Watch boundary"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('id="refresh-all"');
    expect(javascript).toContain("setLoading(");
    expect(javascript).toContain("emptyState(");
    expect(javascript).toContain("renderPageError(");
    expect(javascript).toContain("Promise.allSettled");
  });

  it("same-origin protects each monitor mutation route", () => {
    const route = server.slice(server.indexOf("const projectMonitorMatch"), server.indexOf("if (request.method === \"GET\" && url.pathname === \"/v1/workflow-templates\""));
    expect(route).toContain('request.method === "POST"');
    expect(route).toContain("assertSameOrigin(request.headers)");
    expect(route).toContain('action === "run"');
    expect(route).toContain('action === "pause"');
  });

  it("renders API data through text nodes and does not expose local roots", () => {
    expect(javascript).not.toContain("innerHTML");
    expect(javascript).toContain("textContent");
    expect(javascript).toContain("/v1/watched-projects");
    expect(javascript).toContain("/v1/project-monitors");
    expect(javascript).not.toContain("rootPath");
    expect(html).not.toMatch(/<style[\s>]/i);
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i);
  });

  it("provides attention, healthy, empty, and responsive styles", () => {
    expect(css).toContain(".project-card.has-attention");
    expect(css).toContain(".badge-ok");
    expect(css).toContain(".monitor-history");
    expect(css).toContain(".notification-history");
    expect(sharedCss).toContain(".empty-state");
    expect(css).toContain("@media (max-width: 720px)");
  });

  it("loads Project Watch assets under the restrictive local asset policy", () => {
    const assets = loadMemoryReviewAssets(projectRoot);
    expect(assets.projectHtml.body.toString("utf8")).toBe(html);
    expect(assets.projectCss.body.toString("utf8")).toBe(css);
    expect(assets.projectJavascript.body.toString("utf8")).toBe(javascript);
  });
});
