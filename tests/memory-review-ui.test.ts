import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  loadMemoryReviewAssets,
  memoryReviewHeaders,
} from "../src/ui/memory-review-assets.js";

const projectRoot = resolve(import.meta.dirname, "..");
const html = readFileSync(resolve(projectRoot, "public/memory-review.html"), "utf8");
const css = readFileSync(resolve(projectRoot, "public/memory-review.css"), "utf8");
const javascript = readFileSync(resolve(projectRoot, "public/memory-review.js"), "utf8");

describe("memory review interface", () => {
  it("provides an accessible, externally sourced application shell", () => {
    expect(html).toContain('<a class="skip-link" href="#main">');
    expect(html).toContain('<main id="main">');
    expect(html.match(/role="tab"/g)).toHaveLength(4);
    expect(html.match(/role="tabpanel"/g)).toHaveLength(4);
    expect(html).toContain('id="panel-timeline"');
    expect(html).toContain('id="task-event-form"');
    expect(html).toContain('<dialog class="dialog-wide" id="proposal-dialog"');
    expect(html).toContain('<dialog id="forget-dialog"');
    expect(html).toContain('href="/memory-review.css"');
    expect(html).toContain('src="/memory-review.js"');
    expect(html).not.toMatch(/<style[\s>]/i);
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i);
  });

  it("keeps dynamic records out of HTML parsing sinks", () => {
    expect(javascript).not.toContain("innerHTML");
    expect(javascript).toContain("textContent");
    expect(javascript).toContain("/v1/context-preview");
    expect(javascript).toContain('"approved"');
    expect(javascript).toContain('"rejected"');
    expect(javascript).toContain('"/forget"');
    expect(javascript).toContain('"/events"');
    expect(javascript).toContain("textContent");
    expect(html).toContain("not instructions, authorization, or proof");
  });

  it("includes keyboard focus, narrow-screen, and reduced-motion states", () => {
    expect(css).toContain(":focus-visible");
    expect(css).toContain("@media (max-width: 720px)");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain(".timeline-layout");
    expect(css).toContain(".task-event-form");
  });

  it("loads immutable startup assets with a restrictive local policy", () => {
    const assets = loadMemoryReviewAssets(projectRoot);
    const headers = memoryReviewHeaders(
      assets.html.contentType,
      assets.html.body.byteLength,
    );

    expect(assets.html.body.toString("utf8")).toBe(html);
    expect(headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(headers["cache-control"]).toBe("no-store");
    expect(headers["content-security-policy"]).toContain("default-src 'self'");
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["x-content-type-options"]).toBe("nosniff");
  });
});
