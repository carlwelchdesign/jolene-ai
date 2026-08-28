import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { evaluateSecurityRelease } from "../src/security/security-release-gate.js";

export function checkSecurityRelease(packetPath: string, now = new Date()): ReturnType<typeof evaluateSecurityRelease> {
  const packet = JSON.parse(readFileSync(packetPath, "utf8"));
  return evaluateSecurityRelease(packet, now.toISOString());
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const packetPath = resolve(process.argv[2] ?? "security/security-release-evidence.local.json");
  const result = checkSecurityRelease(packetPath);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status === "blocked") process.exitCode = 1;
}
