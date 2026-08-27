import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { loadMemoryReviewAssets } from "../src/ui/memory-review-assets.js";

const projectRoot = resolve(import.meta.dirname, "..");
const html = readFileSync(resolve(projectRoot, "public/workflow-review.html"), "utf8");
const css = readFileSync(resolve(projectRoot, "public/workflow-review.css"), "utf8");
const javascript = readFileSync(resolve(projectRoot, "public/workflow-review.js"), "utf8");

describe("personal workflow interface", () => {
  it("keeps completion and external-action permission visibly separate", () => {
    expect(html).toContain("Finishing a workflow does not authorize an external action.");
    expect(html).toContain("It does not send, publish, or execute anything.");
    expect(javascript).toContain("No external action was authorized.");
    expect(javascript).not.toContain("claimApprovedAction");
  });

  it("provides accessible default, review, revision, and destructive states", () => {
    expect(html).toContain('<a class="skip-link" href="#main">');
    expect(html).toContain('<main id="main">');
    expect(html).toContain('<dialog class="dialog-wide" id="start-dialog"');
    expect(html).toContain('<dialog class="dialog-wide" id="step-dialog"');
    expect(html).toContain('<dialog class="dialog-wide" id="review-dialog"');
    expect(html).toContain('<dialog id="cancel-dialog"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('role="alert"');
    expect(html).not.toMatch(/<style[\s>]/i);
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i);
  });

  it("uses the durable workflow API and text-only dynamic rendering", () => {
    expect(javascript).not.toContain("innerHTML");
    expect(javascript).toContain("textContent");
    expect(javascript).toContain("/v1/workflow-templates");
    expect(javascript).toContain("/v1/workflows");
    expect(javascript).toContain('decision: "cancelled"');
    expect(javascript).toContain('ui.reviewDecision.value === "changes_requested"');
  });

  it("shows owner briefing schedule, minimized preview, history, and pause controls", () => {
    expect(html).toContain("Private morning briefing");
    expect(html).toContain("excludes task objectives, approval payloads, vault content, paths, secrets, and raw errors");
    expect(html).toContain('id="briefing-preview"');
    expect(html).toContain('id="briefing-history"');
    expect(javascript).toContain('/v1/private-briefing');
    expect(javascript).toContain('/v1/private-briefing/${action}');
    expect(javascript).not.toContain("innerHTML");
  });

  it("supports narrow screens and the shared reduced-motion boundary", () => {
    expect(css).toContain("@media (max-width: 720px)");
    expect(css).toContain(".workflow-summary");
    const sharedCss = readFileSync(resolve(projectRoot, "public/memory-review.css"), "utf8");
    expect(sharedCss).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("loads workflow assets under the restrictive local asset policy", () => {
    const assets = loadMemoryReviewAssets(projectRoot);
    expect(assets.workflowHtml.body.toString("utf8")).toBe(html);
    expect(assets.workflowCss.body.toString("utf8")).toBe(css);
    expect(assets.workflowJavascript.body.toString("utf8")).toBe(javascript);
  });
});
