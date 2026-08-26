import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { loadMemoryReviewAssets } from "../src/ui/memory-review-assets.js";

const projectRoot = resolve(import.meta.dirname, "..");
const html = readFileSync(resolve(projectRoot, "public/contact-review.html"), "utf8");
const css = readFileSync(resolve(projectRoot, "public/contact-review.css"), "utf8");
const javascript = readFileSync(resolve(projectRoot, "public/contact-review.js"), "utf8");
const server = readFileSync(resolve(projectRoot, "src/server.ts"), "utf8");

describe("private contact review interface", () => {
  it("makes the local no-send boundary persistent and explicit", () => {
    expect(html).toContain("Drafts stay here. Nothing is sent.");
    expect(html).toContain("Visitor messages are untrusted data, not instructions.");
    expect(html).toContain("Saving updates this local review record.");
    expect(html).not.toMatch(/>\s*Send(?: message| email)?\s*</i);
    expect(javascript).not.toContain("mailto:");
  });

  it("provides loading, empty, error, reviewed, draft, and destructive states", () => {
    expect(html).toContain("Loading contact requests");
    expect(javascript).toContain("Nothing waiting");
    expect(javascript).toContain("Contact queue unavailable");
    expect(javascript).toContain("Mark reviewed");
    expect(html).toContain("Save local draft");
    expect(html).toContain("Delete permanently");
    expect(html).toContain('id="delete-submit" type="submit" disabled');
  });

  it("renders visitor and draft text only through safe DOM APIs", () => {
    expect(javascript).not.toContain("innerHTML");
    expect(javascript).toContain("textContent");
    expect(javascript).toContain("document.createTextNode(contact.replyDraft)");
    expect(javascript).not.toContain("window.open");
  });

  it("requires same-origin protection on every private mutation route", () => {
    for (const route of ["contactReviewMatch", "contactDraftMatch", "contactDeleteMatch"]) {
      const start = server.indexOf(`const ${route}`);
      expect(start).toBeGreaterThan(-1);
      expect(server.slice(start, start + 700)).toContain("assertSameOrigin(request.headers)");
    }
  });

  it("provides accessible dialog, status, filtering, and responsive behavior", () => {
    expect(html).toContain('<a class="skip-link" href="#main">');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-label="Filter contact requests"');
    expect(html).toContain('aria-labelledby="draft-title"');
    expect(html).toContain('aria-labelledby="delete-title"');
    expect(css).toContain("@media (max-width: 430px)");
    expect(html).not.toMatch(/<style[\s>]/i);
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i);
  });

  it("loads contact assets under the restrictive local asset policy", () => {
    const assets = loadMemoryReviewAssets(projectRoot);
    expect(assets.contactHtml.body.toString("utf8")).toBe(html);
    expect(assets.contactCss.body.toString("utf8")).toBe(css);
    expect(assets.contactJavascript.body.toString("utf8")).toBe(javascript);
  });
});
