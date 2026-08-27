import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

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
    expect(config.personalityResearchDecisionPath).toBe(
      "/tmp/jolene-config-test/.jolene/personality/research-decision.json",
    );
    expect(config.personalityTuningDecisionPath).toBe(
      "/tmp/jolene-config-test/.jolene/personality/tuning-decision.json",
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

  it("loads private credentials from one-line secret files", () => {
    const root = mkdtempSync(path.join(tmpdir(), "jolene-secret-config-"));
    writeFileSync(path.join(root, "openai"), "file-openai-key\n", { mode: 0o600 });
    writeFileSync(path.join(root, "slack-bot"), "file-bot-token\n", { mode: 0o600 });
    writeFileSync(path.join(root, "slack-app"), "file-app-token\n", { mode: 0o600 });

    const config = parseConfig({
      OPENAI_API_KEY_FILE: "openai",
      SLACK_BOT_TOKEN_FILE: "slack-bot",
      SLACK_APP_TOKEN_FILE: "slack-app",
    }, root);

    expect(config.slackBotToken).toBe("file-bot-token");
    expect(config.slackAppToken).toBe("file-app-token");
  });

  it("fails closed on ambiguous or malformed secret-file configuration", () => {
    const root = mkdtempSync(path.join(tmpdir(), "jolene-secret-config-"));
    writeFileSync(path.join(root, "valid"), "file-key\n", { mode: 0o600 });
    writeFileSync(path.join(root, "multiline"), "first\nsecond\n", { mode: 0o600 });
    writeFileSync(path.join(root, "empty"), "\n", { mode: 0o600 });
    writeFileSync(path.join(root, "oversized"), "x".repeat(16 * 1024 + 1), {
      mode: 0o600,
    });

    expect(() => parseConfig({
      OPENAI_API_KEY: "direct-key",
      OPENAI_API_KEY_FILE: "valid",
    }, root)).toThrow(/either a direct value or a secret file/i);
    expect(() => parseConfig({ OPENAI_API_KEY_FILE: "missing" }, root))
      .toThrow("OPENAI_API_KEY secret file is unavailable.");
    expect(() => parseConfig({ OPENAI_API_KEY_FILE: "multiline" }, root))
      .toThrow(/one nonempty line/i);
    expect(() => parseConfig({ OPENAI_API_KEY_FILE: "empty" }, root))
      .toThrow(/one nonempty line/i);
    expect(() => parseConfig({ OPENAI_API_KEY_FILE: "oversized" }, root))
      .toThrow(/too large/i);
    expect(() => parseConfig({ OPENAI_API_KEY: "first\nsecond" }, root))
      .toThrow(/direct value must contain one nonempty line/i);
    expect(() => parseConfig({ OPENAI_API_KEY: ` ${"x".repeat(16 * 1024)}` }, root))
      .toThrow(/direct value is too large/i);
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
