import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { loadMemoryReviewAssets } from "../src/ui/memory-review-assets.js";

const projectRoot = resolve(import.meta.dirname, "..");
const html = readFileSync(resolve(projectRoot, "public/career-evidence.html"), "utf8");
const css = readFileSync(resolve(projectRoot, "public/career-evidence.css"), "utf8");
const javascript = readFileSync(resolve(projectRoot, "public/career-evidence.js"), "utf8");

describe("career evidence review interface", () => {
  it("makes human control and the non-publishing boundary persistent", () => {
    expect(html).toContain("Decide what Jolene may say about your work.");
    expect(html).toContain("Approval changes eligibility, not the outside world.");
    expect(html).toContain("cannot publish a portfolio, message a recruiter, submit an application, or expose your Obsidian vault");
    expect(html).toContain("I confirm this exact claim is appropriate for recruiter-facing answers.");
  });

  it("exposes source-first decisions, explicit public review, and revocation", () => {
    expect(javascript).toContain('"approve_internal"');
    expect(javascript).toContain('"approve_public"');
    expect(javascript).toContain("Approve this source before approving its claims.");
    expect(javascript).toContain("/revoke");
    expect(javascript).not.toContain("innerHTML");
    expect(javascript).toContain("textContent");
  });

  it("provides accessible status, filtering, confirmation, and narrow states", () => {
    expect(html).toContain('<a class="skip-link" href="#main">');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-label="Filter career evidence"');
    expect(html).toContain('<dialog class="dialog-wide" id="decision-dialog"');
    expect(javascript).toContain('document.createElement("details")');
    expect(css).toContain(".check-field[hidden]");
    expect(css).toContain("@media (max-width: 430px)");
    expect(html).not.toMatch(/<style[\s>]/i);
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i);
  });

  it("loads career assets under the restrictive local asset policy", () => {
    const assets = loadMemoryReviewAssets(projectRoot);
    expect(assets.careerHtml.body.toString("utf8")).toBe(html);
    expect(assets.careerCss.body.toString("utf8")).toBe(css);
    expect(assets.careerJavascript.body.toString("utf8")).toBe(javascript);
  });
});
