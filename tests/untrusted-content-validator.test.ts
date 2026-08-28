import { describe, expect, it } from "vitest";

import { validateUntrustedContentEnvelopes } from
  "../scripts/validate-untrusted-content-envelopes.js";

describe("untrusted-content contract validator", () => {
  it("passes all private, public, adversarial, and lineage checks", () => {
    expect(validateUntrustedContentEnvelopes()).toEqual({
      adversarialFixtures: 8,
      privateEnvelopeChecks: 8,
      publicEnvelopeChecks: 3,
      lineageChecks: 3,
      status: "passed",
    });
  });
});
