import { readFileSync } from "node:fs";
import path from "node:path";

const MAX_SECRET_BYTES = 16 * 1024;

export function resolveSecretValue(
  environment: Record<string, string | undefined>,
  valueName: string,
  fileName: string,
  options: {
    readonly required: boolean;
    readonly workingDirectory: string;
  },
): string | undefined {
  const direct = nonempty(environment[valueName]);
  const file = nonempty(environment[fileName]);
  if (direct && file) {
    throw new Error(`${valueName} must use either a direct value or a secret file, not both.`);
  }
  if (direct) {
    return validateSecret(direct, valueName, "direct value");
  }
  if (!file) {
    if (options.required) {
      throw new Error(`${valueName} is required as a direct value or secret file.`);
    }
    return undefined;
  }

  let serialized: string;
  try {
    serialized = readFileSync(path.resolve(options.workingDirectory, file), "utf8");
  } catch {
    throw new Error(`${valueName} secret file is unavailable.`);
  }
  const withoutTerminalNewline = serialized.endsWith("\n")
    ? serialized.slice(0, -1)
    : serialized;
  return validateSecret(withoutTerminalNewline, valueName, "secret file");
}

function nonempty(value: string | undefined): string | undefined {
  return value?.trim() ? value : undefined;
}

function validateSecret(
  value: string,
  valueName: string,
  source: "direct value" | "secret file",
): string {
  if (Buffer.byteLength(value, "utf8") > MAX_SECRET_BYTES) {
    throw new Error(`${valueName} ${source} is too large.`);
  }
  if (value.length === 0 || value !== value.trim() || /[\r\n]/.test(value)) {
    throw new Error(`${valueName} ${source} must contain one nonempty line.`);
  }
  return value;
}
