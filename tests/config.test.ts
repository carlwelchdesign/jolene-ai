import { describe, expect, it } from "vitest";

import { parseConfig } from "../src/config.js";

describe("private runtime configuration", () => {
  it("keeps career embeddings disabled by default", () => {
    const config = parseConfig(
      { OPENAI_API_KEY: "test-key" },
      "/tmp/jolene-config-test",
    );

    expect(config.careerEmbeddingsEnabled).toBe(false);
    expect(config.publicLiveReviewPacketPath).toBe(
      "/tmp/jolene-config-test/.jolene/evaluations/public-live-model-review.json",
    );
    expect(config.publicLiveReviewDecisionPath).toBe(
      "/tmp/jolene-config-test/.jolene/evaluations/public-live-model-decision.json",
    );
  });

  it("requires an exact explicit opt-in for career embeddings", () => {
    const enabled = parseConfig(
      {
        OPENAI_API_KEY: "test-key",
        JOLENE_CAREER_EMBEDDINGS_ENABLED: "true",
      },
      "/tmp/jolene-config-test",
    );

    expect(enabled.careerEmbeddingsEnabled).toBe(true);
    expect(() =>
      parseConfig(
        {
          OPENAI_API_KEY: "test-key",
          JOLENE_CAREER_EMBEDDINGS_ENABLED: "yes",
        },
        "/tmp/jolene-config-test",
      ),
    ).toThrow();
  });
});
