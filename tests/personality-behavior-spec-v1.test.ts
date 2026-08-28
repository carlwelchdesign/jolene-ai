import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { personalityCharacterGraphV1Schema } from
  "../src/personality/personality-character-graph-v1.js";
import {
  buildPersonalityBehaviorSpecV1,
  validatePersonalityBehaviorSpecV1,
} from "../src/personality/personality-behavior-spec-v1.js";
import { OWNER_DESIGNED_CORE_BEHAVIOR } from
  "../src/personality/runtime-personality-policy.js";

const graphPath = new URL("../research/personality-character-graph-v1.json", import.meta.url);
const specificationPath = new URL(
  "../research/personality-behavior-spec-v1.json", import.meta.url,
);

async function loadArtifacts() {
  const [graphText, specificationText] = await Promise.all([
    readFile(graphPath, "utf8"), readFile(specificationPath, "utf8"),
  ]);
  return {
    graph: personalityCharacterGraphV1Schema.parse(JSON.parse(graphText)),
    specification: JSON.parse(specificationText),
  };
}

describe("personality behavior specification v1", () => {
  it("covers every required context and preserves the reviewed priority order", async () => {
    const input = await loadArtifacts();
    const specification = validatePersonalityBehaviorSpecV1(
      input.specification, input.graph,
    );
    expect(specification.contextMatrix.map((entry) => entry.contextClass)).toEqual([
      "normal", "sensitive", "urgent", "public", "private", "error", "conflict",
    ]);
    expect(specification.priorityOrder[0]).toBe("safety-and-privacy");
    expect(specification.priorityOrder.at(-1)).toBe("wit-and-style");
    expect(specification.runtimeActivation).toBe("prohibited");
  });

  it("keeps runtime baseline wording synchronized without changing runtime behavior", async () => {
    const { graph } = await loadArtifacts();
    const specification = buildPersonalityBehaviorSpecV1(graph);
    expect(specification.behaviorRules.ownerDesignedBaseline)
      .toEqual([...OWNER_DESIGNED_CORE_BEHAVIOR]);
    expect(specification.behaviorRules.auditedAdmitted).toEqual([{
      traitFamilyId: "uncertainty-humility",
      rule: "Jolene states what she knows, names evidence gaps plainly, and asks one useful clarifying question instead of bluffing.",
    }]);
  });

  it("rebuilds deterministically from the exact character graph", async () => {
    const input = await loadArtifacts();
    expect(buildPersonalityBehaviorSpecV1(input.graph)).toEqual(input.specification);
  });

  it("rejects a stale graph binding or altered context rule", async () => {
    const input = await loadArtifacts();
    const changed = structuredClone(input.specification);
    changed.contextMatrix[0].personalityLevel = "subdued";
    expect(() => validatePersonalityBehaviorSpecV1(changed, input.graph))
      .toThrow("does not match the reviewed graph");
  });
});
