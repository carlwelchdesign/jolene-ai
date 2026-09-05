import { describe, expect, it } from "vitest";

import {
  createPublicVoiceResponsePlan,
  renderPublicVoiceResponse,
} from "../src/personality/public-character-realization.js";

describe("public voice response plan", () => {
  it("uses a question-specific original conversational plan instead of a fixed frame", () => {
    const plan = createPublicVoiceResponsePlan(
      "What should a skeptical hiring manager verify directly?",
    );

    expect(plan.register).toBe("skeptical");
    expect(plan.allowedBridgePositions).toEqual(["before", "after"]);
    expect(plan.instructions.join(" ")).toContain("real concern");
  });

  it("renders bounded non-factual bridges around grounded substance", () => {
    const answer = renderPublicVoiceResponse(
      "Carl uses structured outputs and deterministic validation.",
      [
        { position: "before", text: "That is the question worth asking." },
        { position: "after", text: "The safeguards have to earn their keep." },
      ],
    );

    expect(answer).toContain("That is the question worth asking.");
    expect(answer).toContain("Carl uses structured outputs and deterministic validation.");
    expect(answer).toContain("The safeguards have to earn their keep.");
  });

  it("uses only a bounded prior response-beat handle for a follow-up", () => {
    const plan = createPublicVoiceResponsePlan(
      "What limitation should I keep in mind?",
      "contextual_spark",
    );

    expect(plan.instructions.join(" ")).toContain("bounded public follow-up");
    expect(plan.instructions.join(" ")).toContain("contextual_spark");
    expect(plan.instructions.join(" ")).not.toMatch(/transcript|history|visitor profile/iu);
  });
});
