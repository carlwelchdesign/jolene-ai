import { describe, expect, it } from "vitest";

import {
  containsInternalPublicProcessLanguage,
  visitorFacingLimitations,
} from "../src/public/public-visitor-language.js";

describe("public visitor language", () => {
  it.each([
    "Contribution boundary: portfolio capability synthesis.",
    "Imported from the portfolio and requires review.",
    "No matching public-approved evidence was found.",
    "This uses preserved source material.",
    "Verified from an internal note.",
    "The reviewed public record says so.",
  ])("recognizes internal process language: %s", (value) => {
    expect(containsInternalPublicProcessLanguage(value)).toBe(true);
  });

  it("keeps substantive product limitations and removes procedural metadata", () => {
    expect(visitorFacingLimitations([
      "Contribution boundary: Imported from the portfolio; requires review.",
      "The product is a demonstration, not a certified operational system.",
      "The product is a demonstration, not a certified operational system.",
    ])).toEqual([
      "The product is a demonstration, not a certified operational system.",
    ]);
  });
});
