import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseConfig, parsePrivateControlToken } from "../src/config.js";

const privateControlToken = "test-private-control-token-with-at-least-forty-three-characters";

function configEnvironment(
  input: Record<string, string | undefined>,
): Record<string, string | undefined> {
  return { JOLENE_PRIVATE_CONTROL_TOKEN: privateControlToken, ...input };
}

describe("private runtime configuration", () => {
  it("keeps career embeddings disabled by default", () => {
    const config = parseConfig(
      configEnvironment({ OPENAI_API_KEY: "test-key" }),
      "/tmp/jolene-config-test",
    );

    expect(config.careerEmbeddingsEnabled).toBe(false);
    expect(config.openaiApiKey).toBe("test-key");
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
    expect(config.conversationQualityPacketPath).toBe(
      "/tmp/jolene-config-test/.jolene/evaluations/conversation-quality-capture.json",
    );
    expect(config.conversationQualityDecisionPath).toBe(
      "/tmp/jolene-config-test/.jolene/evaluations/conversation-quality-decision.json",
    );
  });

  it("requires a high-entropy private control credential", () => {
    expect(() => parsePrivateControlToken({})).toThrow(
      /JOLENE_PRIVATE_CONTROL_TOKEN is required as a direct value or secret file/,
    );
    expect(() => parsePrivateControlToken({
      JOLENE_PRIVATE_CONTROL_TOKEN: "too-short",
    })).toThrow();
    expect(parsePrivateControlToken({
      JOLENE_PRIVATE_CONTROL_TOKEN: privateControlToken,
    })).toBe(privateControlToken);
  });

  it("requires an exact explicit opt-in for career embeddings", () => {
    const enabled = parseConfig(
      configEnvironment({
        OPENAI_API_KEY: "test-key",
        JOLENE_CAREER_EMBEDDINGS_ENABLED: "true",
      }),
      "/tmp/jolene-config-test",
    );

    expect(enabled.careerEmbeddingsEnabled).toBe(true);
    expect(() =>
      parseConfig(
        configEnvironment({
          OPENAI_API_KEY: "test-key",
          JOLENE_CAREER_EMBEDDINGS_ENABLED: "yes",
        }),
        "/tmp/jolene-config-test",
      ),
    ).toThrow();
  });

  it("requires one exact Slack workspace/member pair", () => {
    expect(parseConfig(configEnvironment({
      OPENAI_API_KEY: "test-key",
      SLACK_OWNER_USER_ID: "U0BSN6JA3PC",
      SLACK_OWNER_TEAM_ID: "T0BSQ518J8H",
    })).slackOwnerUserId).toBe("U0BSN6JA3PC");
    expect(parseConfig(configEnvironment({
      OPENAI_API_KEY: "test-key",
      SLACK_OWNER_USER_ID: "U0BSN6JA3PC",
      SLACK_OWNER_TEAM_ID: "T0BSQ518J8H",
    })).slackOwnerTeamId).toBe("T0BSQ518J8H");
    expect(() => parseConfig(configEnvironment({
      OPENAI_API_KEY: "test-key",
      SLACK_OWNER_USER_ID: "UOWNER,UOTHER",
      SLACK_OWNER_TEAM_ID: "T0BSQ518J8H",
    }))).toThrow();
    expect(() => parseConfig(configEnvironment({
      OPENAI_API_KEY: "test-key",
      SLACK_OWNER_USER_ID: "U0BSN6JA3PC",
    }))).toThrow(/must be configured together/);
    expect(() => parseConfig(configEnvironment({
      OPENAI_API_KEY: "test-key",
      SLACK_OWNER_TEAM_ID: "T0BSQ518J8H",
    }))).toThrow(/must be configured together/);
    expect(parseConfig(configEnvironment({
      OPENAI_API_KEY: "test-key",
      SLACK_OWNER_USER_ID: "",
      SLACK_OWNER_TEAM_ID: "",
    })).slackOwnerUserId).toBeUndefined();
  });

  it("loads private credentials from one-line secret files", () => {
    const root = mkdtempSync(path.join(tmpdir(), "jolene-secret-config-"));
    writeFileSync(path.join(root, "openai"), "file-openai-key\n", { mode: 0o600 });
    writeFileSync(path.join(root, "slack-bot"), "file-bot-token\n", { mode: 0o600 });
    writeFileSync(path.join(root, "slack-app"), "file-app-token\n", { mode: 0o600 });
    writeFileSync(path.join(root, "private-control"), `${privateControlToken}\n`, { mode: 0o600 });

    const config = parseConfig({
      OPENAI_API_KEY_FILE: "openai",
      SLACK_BOT_TOKEN_FILE: "slack-bot",
      SLACK_APP_TOKEN_FILE: "slack-app",
      JOLENE_PRIVATE_CONTROL_TOKEN_FILE: "private-control",
    }, root);

    expect(config.slackBotToken).toBe("file-bot-token");
    expect(config.slackAppToken).toBe("file-app-token");
    expect(config.openaiApiKey).toBe("file-openai-key");
    expect(parsePrivateControlToken({
      JOLENE_PRIVATE_CONTROL_TOKEN_FILE: "private-control",
    }, root)).toBe(privateControlToken);
  });

  it("fails closed on ambiguous or malformed secret-file configuration", () => {
    const root = mkdtempSync(path.join(tmpdir(), "jolene-secret-config-"));
    writeFileSync(path.join(root, "valid"), "file-key\n", { mode: 0o600 });
    writeFileSync(path.join(root, "multiline"), "first\nsecond\n", { mode: 0o600 });
    writeFileSync(path.join(root, "empty"), "\n", { mode: 0o600 });
    writeFileSync(path.join(root, "oversized"), "x".repeat(16 * 1024 + 1), {
      mode: 0o600,
    });

    expect(() => parseConfig(configEnvironment({
      OPENAI_API_KEY: "direct-key",
      OPENAI_API_KEY_FILE: "valid",
    }), root)).toThrow(/either a direct value or a secret file/i);
    expect(() => parseConfig(configEnvironment({ OPENAI_API_KEY_FILE: "missing" }), root))
      .toThrow("OPENAI_API_KEY secret file is unavailable.");
    expect(() => parseConfig(configEnvironment({ OPENAI_API_KEY_FILE: "multiline" }), root))
      .toThrow(/one nonempty line/i);
    expect(() => parseConfig(configEnvironment({ OPENAI_API_KEY_FILE: "empty" }), root))
      .toThrow(/one nonempty line/i);
    expect(() => parseConfig(configEnvironment({ OPENAI_API_KEY_FILE: "oversized" }), root))
      .toThrow(/too large/i);
    expect(() => parseConfig(configEnvironment({ OPENAI_API_KEY: "first\nsecond" }), root))
      .toThrow(/direct value must contain one nonempty line/i);
    expect(() => parseConfig(configEnvironment({ OPENAI_API_KEY: ` ${"x".repeat(16 * 1024)}` }), root))
      .toThrow(/direct value is too large/i);
  });

  it("keeps private briefings disabled by default and validates owner schedules", () => {
    const disabled = parseConfig(
      configEnvironment({ OPENAI_API_KEY: "test-key" }),
      "/tmp/jolene-config-test",
    );
    expect(disabled.privateBriefing).toMatchObject({
      enabled: false,
      destination: "slack_owner_dm",
      frequency: "daily",
      timeZone: "America/Los_Angeles",
    });
    const enabled = parseConfig(configEnvironment({
      OPENAI_API_KEY: "test-key",
      JOLENE_PRIVATE_BRIEFING: JSON.stringify({ enabled: true, frequency: "weekly", dayOfWeek: 1 }),
    }));
    expect(enabled.privateBriefing).toMatchObject({ enabled: true, frequency: "weekly", dayOfWeek: 1 });
    expect(() => parseConfig(configEnvironment({
      OPENAI_API_KEY: "test-key",
      JOLENE_PRIVATE_BRIEFING: JSON.stringify({ enabled: true, frequency: "weekly", dayOfWeek: null }),
    }))).toThrow(/day of week/i);
    expect(() => parseConfig(configEnvironment({
      OPENAI_API_KEY: "test-key",
      JOLENE_PRIVATE_BRIEFING: JSON.stringify({ timeZone: "Mars/Olympus" }),
    }))).toThrow(/IANA zone/i);
  });
});
