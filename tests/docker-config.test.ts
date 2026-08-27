import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const projectRoot = resolve(import.meta.dirname, "..");
const dockerfile = readFileSync(resolve(projectRoot, "Dockerfile"), "utf8");
const compose = readFileSync(resolve(projectRoot, "compose.yaml"), "utf8");
const publicCompose = readFileSync(
  resolve(projectRoot, "compose.public.yaml"),
  "utf8",
);
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
    expect(compose).toContain(
      "JOLENE_CAREER_EMBEDDINGS_ENABLED: ${JOLENE_CAREER_EMBEDDINGS_ENABLED:-false}",
    );
    expect(compose).toContain("jolene-data:/data");
    expect(compose).toContain("no-new-privileges:true");
    expect(compose).toContain("127.0.0.1:${JOLENE_HOST_PORT:-8421}:8421");
  });

  it("uses separate API and Slack processes from the same image", () => {
    expect(compose).toContain("jolene-api:");
    expect(compose).toContain("jolene-slack:");
    expect(compose).toContain('["node", "dist/server.js"]');
    expect(compose).toContain('["node", "dist/slack.js"]');
    expect(compose).toMatch(
      /jolene-slack:\n(?:.*\n)*?\s+healthcheck:\n\s+disable: true/,
    );
  });

  it("packages the public delegate without private runtime mounts or secrets", () => {
    expect(publicCompose).toContain("name: jolene-public");
    expect(publicCompose).toContain('["node", "dist/public-server.js"]');
    expect(publicCompose).toContain("JOLENE_PUBLIC_CONTAINER_MODE: \"true\"");
    expect(publicCompose).toContain("target: /public-data/public-career-evidence.json");
    expect(publicCompose).toContain("create_host_path: false");
    expect(publicCompose).toContain("jolene-public-state");
    expect(publicCompose).toContain(
      "JOLENE_PUBLIC_OPENAI_BUDGET_PATH: /public-state/model-budget.json",
    );
    expect(publicCompose).toContain("read_only: true");
    expect(publicCompose).toContain("no-new-privileges:true");
    expect(publicCompose).toContain("127.0.0.1:${JOLENE_PUBLIC_HOST_PORT:-8431}:8431");
    expect(publicCompose).toContain(
      "OPENAI_API_KEY: ${JOLENE_PUBLIC_CONTAINER_OPENAI_API_KEY:-}",
    );
    expect(publicCompose).not.toContain("OPENAI_API_KEY: ${OPENAI_API_KEY");
    expect(publicCompose).not.toContain(".env.local");
    expect(publicCompose).not.toContain("jolene-data");
    expect(publicCompose).not.toContain("/vault");
    expect(publicCompose).not.toContain("SLACK_");
    expect(publicCompose).not.toContain("JOLENE_DATABASE_PATH");
  });
});
