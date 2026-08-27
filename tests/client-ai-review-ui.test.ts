import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { loadMemoryReviewAssets } from "../src/ui/memory-review-assets.js";

const projectRoot = resolve(import.meta.dirname, "..");
const html = readFileSync(resolve(projectRoot, "public/client-ai-review.html"), "utf8");
const css = readFileSync(resolve(projectRoot, "public/client-ai-review.css"), "utf8");
const javascript = readFileSync(resolve(projectRoot, "public/client-ai-review.js"), "utf8");
const server = readFileSync(resolve(projectRoot, "src/server.ts"), "utf8");

describe("client-AI packet review interface", () => {
  it("keeps packet review separate from conversation and delivery", () => {
    expect(html).toContain("Packets do not start a conversation.");
    expect(html).toContain("Every future Jolene message still needs a separate exact-action approval.");
    expect(html).toContain("It still authorizes no message or delivery.");
    expect(javascript).toContain("No conversation was started.");
    expect(javascript).not.toContain("clientAiPackets.recordTurn");
    expect(javascript).not.toMatch(/client-ai-packets.*\/(turns|transcript)/);
    expect(javascript).not.toContain("/v1/chat");
    expect(javascript).not.toContain("/v1/action-proposals");
  });

  it("provides accessible create, exact-decision, cancellation, and handoff states", () => {
    expect(html).toContain('<a class="skip-link" href="#main">');
    expect(html).toContain('<main id="main">');
    expect(html).toContain('<dialog class="dialog-wide" id="create-dialog"');
    expect(html).toContain('<dialog class="dialog-wide" id="decision-dialog"');
    expect(html).toContain('<dialog id="cancel-dialog"');
    expect(html).toContain('<dialog class="dialog-wide" id="handoff-dialog"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('<fieldset class="packet-fieldset">');
    expect(html).toContain('<fieldset class="choice-group">');
    expect(html).not.toMatch(/<style[\s>]/i);
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i);
  });

  it("uses only the owner-bound packet review API and safe text rendering", () => {
    expect(javascript).not.toContain("innerHTML");
    expect(javascript).toContain("textContent");
    expect(javascript).toContain('/v1/client-ai-scope');
    expect(javascript).toContain('/v1/client-ai-recipients');
    expect(javascript).toContain('/v1/client-ai-packets?limit=100');
    expect(javascript).toContain('expectedFingerprint: packet.payloadFingerprint');
    expect(javascript).toContain('/handoffs/');
    expect(server).toContain('url.pathname === "/client-ai"');
    expect(server).toContain('url.pathname === "/v1/client-ai-scope"');
  });

  it("supports narrow screens, readable detail, and shared reduced motion", () => {
    expect(css).toContain("@media (max-width: 720px)");
    expect(css).toContain(".packet-sections");
    expect(css).toContain("overflow-wrap: anywhere");
    const sharedCss = readFileSync(resolve(projectRoot, "public/memory-review.css"), "utf8");
    expect(sharedCss).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("loads all assets under the restrictive local asset policy", () => {
    const assets = loadMemoryReviewAssets(projectRoot);
    expect(assets.clientAiHtml.body.toString("utf8")).toBe(html);
    expect(assets.clientAiCss.body.toString("utf8")).toBe(css);
    expect(assets.clientAiJavascript.body.toString("utf8")).toBe(javascript);
  });

  it("adds the Client AI destination to every private control-center page", () => {
    for (const filename of [
      "action-review.html",
      "contact-review.html",
      "memory-review.html",
      "public-evaluation-review.html",
      "workflow-review.html",
      "project-watch.html",
      "career-evidence.html",
    ]) {
      expect(readFileSync(resolve(projectRoot, "public", filename), "utf8"))
        .toContain('<a href="/client-ai">Client AI</a>');
    }
  });
});
