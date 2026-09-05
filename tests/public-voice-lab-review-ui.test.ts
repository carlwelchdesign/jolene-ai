import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { loadMemoryReviewAssets } from "../src/ui/memory-review-assets.js";

const root = resolve(import.meta.dirname, "..");
const html = readFileSync(resolve(root, "public/voice-lab.html"), "utf8");
const javascript = readFileSync(resolve(root, "public/voice-lab.js"), "utf8");
const server = readFileSync(resolve(root, "src/server.ts"), "utf8");

describe("public voice-lab review UI", () => {
  it("keeps scoring local, explicit, and separate from generation", () => {
    expect(html).toContain("cannot call a model, publish, deploy");
    for (const dimension of ["grounding", "usefulness", "originality", "conversational_aliveness", "restraint"]) expect(javascript).toContain(dimension);
    expect(javascript).not.toContain("innerHTML");
  });

  it("serves local assets and same-origin protects decisions", () => {
    expect(server).toContain('url.pathname === "/voice-lab"');
    const route = server.indexOf('url.pathname === "/v1/public-voice-lab-review/decision"');
    expect(server.slice(route, route + 400)).toContain("assertSameOrigin(request.headers)");
    const assets = loadMemoryReviewAssets(root);
    expect(assets.voiceLabHtml.body.byteLength).toBeGreaterThan(500);
    expect(assets.voiceLabCss.body.byteLength).toBeGreaterThan(500);
    expect(assets.voiceLabJavascript.body.byteLength).toBeGreaterThan(1_000);
  });
});
