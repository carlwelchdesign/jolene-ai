import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  validatePromptInjectionThreatModel,
  validatePromptInjectionThreatModelData,
} from "../scripts/validate-prompt-injection-threat-model.js";

function canonicalModel(): Record<string, unknown> {
  return JSON.parse(
    readFileSync(
      resolve(process.cwd(), "plans/security/prompt-injection-threat-model.v1.json"),
      "utf8",
    ),
  ) as Record<string, unknown>;
}

describe("prompt-injection threat model", () => {
  it("validates the implementation-ready control matrix", () => {
    expect(validatePromptInjectionThreatModel()).toEqual({
      actors: 7,
      dataInventory: 9,
      boundaries: 18,
      controls: 35,
      threats: 20,
      risks: 9,
      gates: 9,
      decisions: 6,
      tickets: 8,
      status: "implementation_ready",
    });
  });

  it("rejects broken control references", () => {
    const model = canonicalModel();
    const threats = model.threats as Array<Record<string, unknown>>;
    threats[0]!.preventionControlIds = ["C99"];
    expect(() => validatePromptInjectionThreatModelData(model)).toThrow(/unknown references: C99/);
  });

  it("rejects incomplete threat-family coverage", () => {
    const model = canonicalModel();
    const threats = model.threats as Array<Record<string, unknown>>;
    for (const threat of threats) {
      threat.families = (threat.families as string[]).filter((family) => family !== "encoding_evasion");
    }
    expect(() => validatePromptInjectionThreatModelData(model)).toThrow(/encoding_evasion/);
  });

  it("rejects risk scores that do not match likelihood and impact", () => {
    const model = canonicalModel();
    const risks = model.risks as Array<Record<string, unknown>>;
    risks[0]!.score = 1;
    expect(() => validatePromptInjectionThreatModelData(model)).toThrow(/score must equal/);
  });

  it("rejects prerequisite ordering that violates one-ticket delivery", () => {
    const model = canonicalModel();
    const tickets = model.tickets as Array<Record<string, unknown>>;
    tickets[1]!.prerequisites = ["JOL-SEC-009"];
    expect(() => validatePromptInjectionThreatModelData(model)).toThrow(/must appear earlier/);
  });

  it("rejects planned controls presented as current boundary protection", () => {
    const model = canonicalModel();
    const boundaries = model.boundaries as Array<Record<string, unknown>>;
    boundaries[0]!.currentControlIds = ["C26"];
    expect(() => validatePromptInjectionThreatModelData(model)).toThrow(/labels planned control C26 as current/);
  });

  it("rejects private paths and credential material", () => {
    const model = canonicalModel();
    const assumptions = model.assumptions as Array<Record<string, unknown>>;
    assumptions[0]!.statement = "Read /Users/example/private-note.md";
    expect(() => validatePromptInjectionThreatModelData(model)).toThrow(/absolute user path/);
  });
});
