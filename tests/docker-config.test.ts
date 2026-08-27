import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const projectRoot = resolve(import.meta.dirname, "..");
const dockerfile = readFileSync(resolve(projectRoot, "Dockerfile"), "utf8");
const compose = readFileSync(resolve(projectRoot, "compose.yaml"), "utf8");
const dockerignore = readFileSync(resolve(projectRoot, ".dockerignore"), "utf8");

describe("Docker runtime boundary", () => {
  it("builds on Node 22 and runs as an unprivileged user", () => {
    expect(dockerfile).toContain("FROM node:22-bookworm-slim");
    expect(dockerfile).toContain("USER node");
    expect(dockerfile).toContain("HEALTHCHECK");
  });

  it("keeps secrets and private runtime artifacts outside the image", () => {
    expect(dockerignore).toMatch(/^\.env\.\*$/m);
    expect(dockerignore).toMatch(/^\.jolene$/m);
    expect(dockerignore).toMatch(/^node_modules$/m);
    expect(dockerfile).not.toContain(".env.local");
    expect(dockerfile).not.toContain("Carl Knowledge Vault");
  });

  it("mounts the vault read-only and keeps persistence explicit", () => {
    expect(compose).toContain("target: /vault");
    expect(compose).toContain("read_only: true");
    expect(compose).toContain("JOLENE_DATABASE_PATH: /data/jolene.sqlite");
    expect(compose).toContain("JOLENE_HOST: 0.0.0.0");
    expect(compose).toContain("jolene-data:/data");
    expect(compose).toContain("no-new-privileges:true");
    expect(compose).toContain("127.0.0.1:${JOLENE_HOST_PORT:-8421}:8421");
  });

  it("uses separate API and Slack processes from the same image", () => {
    expect(compose).toContain("jolene-api:");
    expect(compose).toContain("jolene-slack:");
    expect(compose).toContain('["node", "dist/server.js"]');
    expect(compose).toContain('["node", "dist/slack.js"]');
  });
});
