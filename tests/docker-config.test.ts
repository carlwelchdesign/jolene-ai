import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const projectRoot = resolve(import.meta.dirname, "..");
const dockerfile = readFileSync(resolve(projectRoot, "Dockerfile"), "utf8");
const compose = readFileSync(resolve(projectRoot, "compose.yaml"), "utf8");
const publicCompose = readFileSync(
  resolve(projectRoot, "compose.public.yaml"),
  "utf8",
);
const dockerignore = readFileSync(resolve(projectRoot, ".dockerignore"), "utf8");
const packageJson = JSON.parse(
  readFileSync(resolve(projectRoot, "package.json"), "utf8"),
) as { readonly scripts: Readonly<Record<string, string>> };
const parsedCompose = parse(compose, { merge: true }) as {
  readonly secrets?: Readonly<Record<string, { readonly file?: string }>>;
  readonly "x-jolene-runtime"?: {
    readonly secrets?: readonly string[];
  };
  readonly services: Readonly<Record<string, {
    readonly command?: readonly string[];
    readonly environment?: Readonly<Record<string, string>>;
    readonly network_mode?: string;
    readonly ports?: readonly string[];
    readonly profiles?: readonly string[];
    readonly read_only?: boolean;
    readonly secrets?: readonly (string | { readonly source?: string })[];
    readonly volumes?: readonly (string | {
      readonly source?: string;
      readonly target?: string;
    })[];
  }>>;
};

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
    expect(compose).toContain(
      "JOLENE_PRIVATE_RETRIEVAL_PROVIDER_EGRESS: ${JOLENE_PRIVATE_RETRIEVAL_PROVIDER_EGRESS:-local_only}",
    );
    expect(compose).toContain("jolene-data:/data");
    expect(compose).toContain("JOLENE_PUBLIC_LIVE_REVIEW_PACKET_PATH: /review/public-live-model-review.json");
    expect(compose).toContain("JOLENE_PUBLIC_LIVE_REVIEW_DECISION_PATH: /data/evaluations/public-live-model-decision.json");
    expect(compose).toContain("JOLENE_PERSONALITY_RESEARCH_DECISION_PATH: /data/personality/research-decision.json");
    expect(compose).toContain("JOLENE_PERSONALITY_TUNING_DECISION_PATH: /data/personality/tuning-decision.json");
    expect(compose).toContain("JOLENE_PERSONALITY_MODE: ${JOLENE_PERSONALITY_MODE:-jolene}");
    expect(compose).toContain("JOLENE_CONVERSATION_QUALITY_PACKET_PATH: /review/conversation-quality-capture.json");
    expect(compose).toContain("JOLENE_CONVERSATION_QUALITY_DECISION_PATH: /data/evaluations/conversation-quality-decision.json");
    expect(dockerfile).toContain("COPY --chown=node:node research ./research");
    expect(dockerfile).toContain(
      "COPY --chown=node:node evaluations/conversational-quality-v1.json ./evaluations/conversational-quality-v1.json",
    );
    expect(compose).toMatch(
      /jolene-api:\n(?:.*\n)*?\s+source: \.\/\.jolene\/evaluations\n\s+target: \/review\n\s+read_only: true/,
    );
    expect(compose).not.toMatch(
      /x-jolene-runtime:[\s\S]*?source: \.\/\.jolene\/evaluations[\s\S]*?services:/,
    );
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

  it("injects least-privilege private secret files instead of loading .env.local", () => {
    expect(compose).not.toContain("- .env.local");
    expect(compose).toContain("path: .env.runtime.local");
    expect(compose).toContain("required: false");
    expect(parsedCompose.secrets).toEqual({
      jolene_private_control_token: { file: "./.jolene/secrets/private-control-token" },
      openai_api_key: { file: "./.jolene/secrets/openai-api-key" },
      slack_app_token: { file: "./.jolene/secrets/slack-app-token" },
      slack_bot_token: { file: "./.jolene/secrets/slack-bot-token" },
    });
    expect(parsedCompose["x-jolene-runtime"]?.secrets).toEqual([
      "openai_api_key",
    ]);
    expect(parsedCompose.services["jolene-api"]?.secrets).toEqual([
      "openai_api_key",
      "jolene_private_control_token",
    ]);
    expect(parsedCompose.services["jolene-slack"]?.secrets).toEqual([
      "openai_api_key",
      "slack_app_token",
      "slack_bot_token",
    ]);
    expect(parsedCompose.services["jolene-career-export"]?.secrets).toBeUndefined();
    expect(parsedCompose.services["jolene-slack"]?.environment).toMatchObject({
      OPENAI_API_KEY_FILE: "/run/secrets/openai_api_key",
      JOLENE_DATABASE_PATH: "/data/jolene.sqlite",
      JOLENE_OBSIDIAN_VAULT_ROOT: "/vault",
      SLACK_APP_TOKEN_FILE: "/run/secrets/slack_app_token",
      SLACK_BOT_TOKEN_FILE: "/run/secrets/slack_bot_token",
    });
    expect(parsedCompose.services["jolene-api"]?.environment).toMatchObject({
      JOLENE_PRIVATE_CONTROL_TOKEN_FILE:
        "/run/secrets/jolene_private_control_token",
    });
    expect(compose).not.toMatch(/^\s+OPENAI_API_KEY:/m);
    expect(compose).not.toMatch(/^\s+SLACK_(?:APP|BOT)_TOKEN:/m);
  });

  it("packages private career MCP as a canonical-volume stdio tool only", () => {
    const mcp = parsedCompose.services["jolene-career-mcp"];
    expect(mcp).toBeDefined();
    expect(mcp?.command).toEqual(["node", "dist/private-career-mcp.js"]);
    expect(mcp?.profiles).toEqual(["tools"]);
    expect(mcp?.network_mode).toBe("none");
    expect(mcp?.ports).toBeUndefined();
    expect(mcp?.secrets).toBeUndefined();
    expect(mcp?.volumes).toEqual(["jolene-data:/data"]);
    expect(mcp?.environment).toEqual({
      JOLENE_MCP_DATABASE_PATH: "/data/jolene.sqlite",
      JOLENE_MCP_ACTOR_ID: "${JOLENE_OWNER_ACTOR_ID:-carl}",
      JOLENE_MCP_WORKSPACE_ID:
        "${JOLENE_CAREER_WORKSPACE_ID:-professional}",
      JOLENE_MCP_CLIENT_ID: "${JOLENE_MCP_CLIENT_ID:-codex-local}",
    });
    expect(publicCompose).not.toContain("private-career-mcp");
    expect(publicCompose).not.toContain("JOLENE_MCP_");
  });

  it("packages a network-free lexical career-index operation", () => {
    expect(packageJson.scripts["start:career-index:lexical"]).toBe(
      "node dist/career-index.js",
    );
  });

  it("audits canonical career relationship topology without network or write access", () => {
    expect(packageJson.scripts["career:relationships:audit"]).toBe(
      "docker compose --profile tools run --rm --build jolene-career-topology-audit",
    );
    expect(packageJson.scripts["start:career-relationships:audit"]).toBe(
      "node dist/career-topology.js",
    );
    const audit = parsedCompose.services["jolene-career-topology-audit"];
    expect(audit).toBeDefined();
    expect(audit?.command).toEqual(["node", "dist/career-topology.js"]);
    expect(audit?.profiles).toEqual(["tools"]);
    expect(audit?.network_mode).toBe("none");
    expect(audit?.ports).toBeUndefined();
    expect(audit?.secrets).toBeUndefined();
    expect(audit?.read_only).toBe(true);
    expect(audit?.volumes).toEqual(["jolene-data:/data:ro"]);
    expect(audit?.environment).toEqual({
      JOLENE_DATABASE_PATH: "/data/jolene.sqlite",
      JOLENE_OWNER_ACTOR_ID: "${JOLENE_OWNER_ACTOR_ID:-carl}",
      JOLENE_CAREER_WORKSPACE_ID:
        "${JOLENE_CAREER_WORKSPACE_ID:-professional}",
    });
    expect(publicCompose).not.toContain("career-topology");
  });

  it("exports public career evidence from the canonical volume without private credentials", () => {
    expect(packageJson.scripts["career:export-public"]).toBe(
      "docker compose --profile tools run --rm --build jolene-career-export",
    );
    expect(packageJson.scripts["start:career-export"]).toBe(
      "node dist/career-export.js",
    );

    const exporter = parsedCompose.services["jolene-career-export"];
    expect(exporter).toBeDefined();
    expect(exporter?.command).toEqual(["node", "dist/career-export.js"]);
    expect(exporter?.profiles).toEqual(["tools"]);
    expect(exporter?.network_mode).toBe("none");
    expect(exporter?.environment).toEqual({
      JOLENE_DATABASE_PATH: "/data/jolene.sqlite",
      JOLENE_PUBLIC_CAREER_EXPORT_PATH: "/exports/public-career-evidence.json",
      JOLENE_OWNER_ACTOR_ID: "${JOLENE_OWNER_ACTOR_ID:-carl}",
      JOLENE_CAREER_WORKSPACE_ID:
        "${JOLENE_CAREER_WORKSPACE_ID:-professional}",
    });
    expect(exporter?.volumes).toEqual([
      "jolene-data:/data",
      {
        type: "bind",
        source: "./.jolene/exports",
        target: "/exports",
      },
    ]);
    expect(Object.keys(exporter?.environment ?? {})).not.toEqual(
      expect.arrayContaining([
        "OPENAI_API_KEY",
        "SLACK_APP_TOKEN",
        "SLACK_BOT_TOKEN",
        "JOLENE_OBSIDIAN_VAULT_ROOT",
        "JOLENE_PORTFOLIO_ROOT",
      ]),
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
    expect(publicCompose).toContain("JOLENE_PUBLIC_OPERATIONS_HOST: 127.0.0.1");
    expect(publicCompose).toContain("JOLENE_PUBLIC_OPERATIONS_PORT: 8432");
    expect(publicCompose).toContain(
      "JOLENE_PERSONALITY_MODE: ${JOLENE_PERSONALITY_MODE:-jolene}",
    );
    expect(publicCompose).toContain(
      "JOLENE_PUBLIC_AUTH_MODE: ${JOLENE_PUBLIC_AUTH_MODE:-disabled}",
    );
    expect(publicCompose).toContain(
      "JOLENE_PUBLIC_API_TOKEN: ${JOLENE_PUBLIC_API_TOKEN:-}",
    );
    expect(publicCompose).toContain("http://127.0.0.1:8432/ready");
    expect(publicCompose).not.toContain("127.0.0.1:8432:8432");
    expect(publicCompose).toContain(
      "OPENAI_API_KEY: ${JOLENE_PUBLIC_CONTAINER_OPENAI_API_KEY:-}",
    );
    expect(publicCompose).not.toContain("OPENAI_API_KEY: ${OPENAI_API_KEY");
    expect(publicCompose).not.toContain(".env.local");
    expect(publicCompose).not.toContain("jolene-data");
    expect(publicCompose).not.toContain("/vault");
    expect(publicCompose).not.toContain("SLACK_");
    expect(publicCompose).not.toContain("JOLENE_DATABASE_PATH");
    expect(publicCompose).not.toContain("NEXT_PUBLIC_JOLENE_PUBLIC_API_TOKEN");
  });
});
