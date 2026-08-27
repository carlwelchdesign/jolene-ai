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

  it("accepts one Slack owner member ID and rejects multi-user destinations", () => {
    expect(parseConfig({
      OPENAI_API_KEY: "test-key",
      SLACK_OWNER_USER_ID: "U0BSN6JA3PC",
    }).slackOwnerUserId).toBe("U0BSN6JA3PC");
    expect(() => parseConfig({
      OPENAI_API_KEY: "test-key",
      SLACK_OWNER_USER_ID: "UOWNER,UOTHER",
    })).toThrow();
    expect(parseConfig({
      OPENAI_API_KEY: "test-key",
      SLACK_OWNER_USER_ID: "",
    }).slackOwnerUserId).toBeUndefined();
  });

  it("keeps private briefings disabled by default and validates owner schedules", () => {
    const disabled = parseConfig(
      { OPENAI_API_KEY: "test-key" },
      "/tmp/jolene-config-test",
    );
    expect(disabled.privateBriefing).toMatchObject({
      enabled: false,
      destination: "slack_owner_dm",
      frequency: "daily",
      timeZone: "America/Los_Angeles",
    });
    const enabled = parseConfig({
      OPENAI_API_KEY: "test-key",
      JOLENE_PRIVATE_BRIEFING: JSON.stringify({ enabled: true, frequency: "weekly", dayOfWeek: 1 }),
    });
    expect(enabled.privateBriefing).toMatchObject({ enabled: true, frequency: "weekly", dayOfWeek: 1 });
    expect(() => parseConfig({
      OPENAI_API_KEY: "test-key",
      JOLENE_PRIVATE_BRIEFING: JSON.stringify({ enabled: true, frequency: "weekly", dayOfWeek: null }),
    })).toThrow(/day of week/i);
    expect(() => parseConfig({
      OPENAI_API_KEY: "test-key",
      JOLENE_PRIVATE_BRIEFING: JSON.stringify({ timeZone: "Mars/Olympus" }),
    })).toThrow(/IANA zone/i);
  });
});
