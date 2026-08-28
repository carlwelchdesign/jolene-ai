import { describe, expect, it } from "vitest";

import { extractPrivateCitations } from
  "../src/evaluation/conversational-quality-evaluation.js";

describe("conversational quality capture", () => {
  it("normalizes exact private note and heading citations without response prose", () => {
    expect(extractPrivateCitations(
      "Dinner is handled.\n*Source: `06 Personal/Recipes and Cooking.md` — “Linguine carbonara — saved draft”*",
    )).toEqual([{
      id: "obsidian:06 Personal/Recipes and Cooking.md#Linguine carbonara — saved draft",
      label: "06 Personal/Recipes and Cooking.md — Linguine carbonara — saved draft",
    }]);
  });

  it("does not invent a citation when the response has none", () => {
    expect(extractPrivateCitations("I do not have a source for that.")).toEqual([]);
  });

  it("accepts the renderer's bold-heading source form", () => {
    expect(extractPrivateCitations(
      "Source: `06 Personal/Recipes and Cooking.md` — **Linguine carbonara — saved draft**",
    )).toHaveLength(1);
  });
});
