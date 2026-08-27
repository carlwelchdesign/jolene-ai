import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import dotenv from "dotenv";

const SECRET_FILES = [
  ["OPENAI_API_KEY", "openai-api-key"],
  ["SLACK_APP_TOKEN", "slack-app-token"],
  ["SLACK_BOT_TOKEN", "slack-bot-token"],
] as const;
const FILTERED_KEYS = new Set([
  ...SECRET_FILES.map(([key]) => key),
  ...SECRET_FILES.map(([key]) => `${key}_FILE`),
]);

export interface ComposeSecretMigrationInput {
  readonly sourceEnvironmentPath: string;
  readonly runtimeEnvironmentPath: string;
  readonly secretsDirectory: string;
  readonly replace?: boolean;
}

export interface ComposeSecretMigrationResult {
  readonly migratedSecretNames: readonly string[];
  readonly runtimeEnvironmentCreated: boolean;
}

export async function migrateComposeSecrets(
  input: ComposeSecretMigrationInput,
): Promise<ComposeSecretMigrationResult> {
  const sourcePath = path.resolve(input.sourceEnvironmentPath);
  const runtimePath = path.resolve(input.runtimeEnvironmentPath);
  const secretsDirectory = path.resolve(input.secretsDirectory);
  const source = await readFile(sourcePath, "utf8");
  const parsed = dotenv.parse(source);
  const secretValues = SECRET_FILES.map(([name, filename]) => {
    const value = parsed[name]?.trim();
    if (!value || /[\r\n]/.test(value)) {
      throw new Error(`${name} must contain one nonempty line before migration.`);
    }
    return { name, filename, value };
  });
  const runtimeEnvironment = source.split(/(?<=\n)/).filter((line) => {
    const match = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/);
    return !match?.[1] || !FILTERED_KEYS.has(match[1]);
  }).join("");
  if (SECRET_FILES.some(([name]) => runtimeEnvironment.includes(`${name}=`))) {
    throw new Error("Runtime environment filtering failed closed.");
  }

  await mkdir(secretsDirectory, { recursive: true, mode: 0o700 });
  await chmod(secretsDirectory, 0o700);
  const created: string[] = [];
  try {
    for (const secret of secretValues) {
      const writeResult = await writePrivateFile(
        path.join(secretsDirectory, secret.filename),
        `${secret.value}\n`,
        input.replace ?? false,
      );
      if (writeResult === "created") {
        created.push(path.join(secretsDirectory, secret.filename));
      }
    }
    if (
      await writePrivateFile(runtimePath, runtimeEnvironment, input.replace ?? false) ===
        "created"
    ) {
      created.push(runtimePath);
    }
  } catch (error) {
    if (!(input.replace ?? false)) {
      await Promise.all(created.map((filePath) => rm(filePath, { force: true })));
    }
    throw error;
  }

  return {
    migratedSecretNames: SECRET_FILES.map(([name]) => name),
    runtimeEnvironmentCreated: true,
  };
}

async function writePrivateFile(
  filePath: string,
  content: string,
  replace: boolean,
): Promise<"created" | "replaced" | "unchanged"> {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  try {
    const existing = await readFile(filePath, "utf8");
    if (existing === content) {
      await chmod(filePath, 0o600);
      return "unchanged";
    }
    if (!replace) {
      throw new Error("Compose secret migration target already exists with different content.");
    }
  } catch (error) {
    if (!isMissingFile(error)) throw error;
  }

  if (!replace) {
    await writeFile(filePath, content, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await chmod(filePath, 0o600);
    return "created";
  }

  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, content, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  try {
    await rename(temporaryPath, filePath);
    await chmod(filePath, 0o600);
    return "replaced";
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT";
}
