import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { migrateComposeSecrets } from
  "../src/application/compose-secret-migration.js";

describe("migrateComposeSecrets", () => {
  it("separates secrets into owner-only files and preserves non-secret runtime config", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "jolene-compose-secrets-"));
    const sourcePath = path.join(root, ".env.local");
    const runtimePath = path.join(root, ".env.runtime.local");
    const secretsPath = path.join(root, ".jolene", "secrets");
    await writeFile(
      sourcePath,
      [
        "OPENAI_API_KEY=private-openai-value",
        "JOLENE_MODEL=gpt-test",
        "SLACK_APP_TOKEN=private-app-value",
        "SLACK_BOT_TOKEN=private-bot-value",
        "SLACK_OWNER_USER_ID=UOWNER",
        "JOLENE_PRIVATE_BRIEFING={\\\"enabled\\\":false}",
        "",
      ].join("\n"),
      { mode: 0o600 },
    );

    const result = await migrateComposeSecrets({
      sourceEnvironmentPath: sourcePath,
      runtimeEnvironmentPath: runtimePath,
      secretsDirectory: secretsPath,
    });
    const runtime = await readFile(runtimePath, "utf8");

    expect(result).toEqual({
      migratedSecretNames: [
        "OPENAI_API_KEY",
        "SLACK_APP_TOKEN",
        "SLACK_BOT_TOKEN",
      ],
      runtimeEnvironmentCreated: true,
    });
    expect(runtime).toContain("JOLENE_MODEL=gpt-test");
    expect(runtime).toContain("SLACK_OWNER_USER_ID=UOWNER");
    expect(runtime).not.toContain("private-openai-value");
    expect(runtime).not.toContain("private-app-value");
    expect(runtime).not.toContain("private-bot-value");
    expect(await readFile(path.join(secretsPath, "openai-api-key"), "utf8"))
      .toBe("private-openai-value\n");
    expect(await readFile(path.join(secretsPath, "slack-app-token"), "utf8"))
      .toBe("private-app-value\n");
    expect(await readFile(path.join(secretsPath, "slack-bot-token"), "utf8"))
      .toBe("private-bot-value\n");
    expect((await stat(runtimePath)).mode & 0o777).toBe(0o600);
    expect((await stat(secretsPath)).mode & 0o777).toBe(0o700);
    for (const name of ["openai-api-key", "slack-app-token", "slack-bot-token"]) {
      expect((await stat(path.join(secretsPath, name))).mode & 0o777).toBe(0o600);
    }
  });

  it("is idempotent and requires explicit replacement for changed values", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "jolene-compose-secrets-"));
    const sourcePath = path.join(root, ".env.local");
    const runtimePath = path.join(root, ".env.runtime.local");
    const secretsPath = path.join(root, "secrets");
    await writeFile(sourcePath, [
      "OPENAI_API_KEY=first-openai",
      "SLACK_APP_TOKEN=first-app",
      "SLACK_BOT_TOKEN=first-bot",
      "",
    ].join("\n"));
    await migrateComposeSecrets({
      sourceEnvironmentPath: sourcePath,
      runtimeEnvironmentPath: runtimePath,
      secretsDirectory: secretsPath,
    });

    await expect(migrateComposeSecrets({
      sourceEnvironmentPath: sourcePath,
      runtimeEnvironmentPath: runtimePath,
      secretsDirectory: secretsPath,
    })).resolves.toMatchObject({ runtimeEnvironmentCreated: true });
    expect(await readFile(path.join(secretsPath, "openai-api-key"), "utf8"))
      .toBe("first-openai\n");

    await writeFile(sourcePath, [
      "OPENAI_API_KEY=replacement-openai",
      "SLACK_APP_TOKEN=replacement-app",
      "SLACK_BOT_TOKEN=replacement-bot",
      "",
    ].join("\n"));
    await expect(migrateComposeSecrets({
      sourceEnvironmentPath: sourcePath,
      runtimeEnvironmentPath: runtimePath,
      secretsDirectory: secretsPath,
    })).rejects.toThrow(/different content/i);
    await migrateComposeSecrets({
      sourceEnvironmentPath: sourcePath,
      runtimeEnvironmentPath: runtimePath,
      secretsDirectory: secretsPath,
      replace: true,
    });
    expect(await readFile(path.join(secretsPath, "openai-api-key"), "utf8"))
      .toBe("replacement-openai\n");
  });
});
