import { describe, expect, it } from "vitest";

import { validatePersonalityResearch } from "../scripts/validate-personality-research.js";

describe("personality research pilot", () => {
  it("validates the rights-conscious source register and observation corpus", async () => {
    await expect(validatePersonalityResearch()).resolves.toMatchObject({
      registeredSources: 11,
      observations: 25,
      codedSources: 5,
      independentlyReviewed: 7,
      evidenceClasses: ["observed", "inferred", "designed"],
    });
  });
});
