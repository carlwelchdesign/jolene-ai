import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { loadMemoryReviewAssets } from "../src/ui/memory-review-assets.js";

const projectRoot = resolve(import.meta.dirname, "..");
const html = readFileSync(resolve(projectRoot, "public/action-review.html"), "utf8");
const css = readFileSync(resolve(projectRoot, "public/action-review.css"), "utf8");
const javascript = readFileSync(resolve(projectRoot, "public/action-review.js"), "utf8");

describe("action approval interface", () => {
  it("makes the no-delivery boundary persistent and explicit", () => {
    expect(html).toContain("Approval is permission—not proof of delivery.");
    expect(html).toContain("Approved messages remain inert.");
    expect(html).toContain("Approve this exact message?");
    expect(html).toContain("nothing is sent now");
    expect(html).not.toMatch(/>\s*Send(?: message)?\s*</i);
  });

  it("provides accessible review, staging, scope, and status regions", () => {
    expect(html).toContain('<a class="skip-link" href="#main">');
    expect(html).toContain('<main id="main">');
    expect(html).toContain('<dialog class="dialog-wide" id="approve-dialog"');
    expect(html).toContain('<dialog class="dialog-wide" id="stage-dialog"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-label="Filter action proposals"');
    expect(html).not.toMatch(/<style[\s>]/i);
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i);
  });

  it("renders API content through text nodes and exposes no claim operation", () => {
    expect(javascript).not.toContain("innerHTML");
    expect(javascript).toContain("textContent");
    expect(javascript).toContain("/v1/action-proposals");
    expect(javascript).toContain('decision: "approved"');
    expect(javascript).toContain('decision },');
    expect(javascript).not.toContain("claimApprovedAction");
    expect(javascript).not.toContain("execution-claim");
  });

  it("adds responsive exact-review and sensitive-action states", () => {
    expect(css).toContain(".exact-review");
    expect(css).toContain(".action-card.is-sensitive");
    expect(css).toContain("@media (max-width: 720px)");
  });

  it("loads approval assets under the same restrictive asset boundary", () => {
    const assets = loadMemoryReviewAssets(projectRoot);
    expect(assets.actionHtml.body.toString("utf8")).toBe(html);
    expect(assets.actionCss.body.toString("utf8")).toBe(css);
    expect(assets.actionJavascript.body.toString("utf8")).toBe(javascript);
  });
});
