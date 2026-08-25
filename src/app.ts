import { promises as fs } from "node:fs";
import path from "node:path";

import { OpenAIJoleneRunner } from "./agent/agent-runner.js";
import { JoleneService } from "./application/jolene-service.js";
import type { AppConfig } from "./config.js";
import {
  type KnowledgeSource,
  UnavailableKnowledgeSource,
} from "./knowledge/knowledge-source.js";
import { ObsidianKnowledgeSource } from "./knowledge/obsidian-source.js";
import { SqliteConversationStore } from "./persistence/sqlite-conversation-store.js";

export interface JoleneApplication {
  readonly service: JoleneService;
  readonly health: () => {
    readonly status: "ok";
    readonly knowledge: "configured" | "unavailable";
    readonly model: string;
  };
  readonly close: () => void;
}

export async function createApplication(
  config: AppConfig,
): Promise<JoleneApplication> {
  const store = new SqliteConversationStore(config.databasePath);
  const knowledge = createKnowledgeSource(config);
  const instructions = await fs.readFile(
    path.resolve(process.cwd(), "docs/prompt.md"),
    "utf8",
  );
  const runner = new OpenAIJoleneRunner({
    model: config.model,
    instructions,
    knowledge,
  });
  const service = new JoleneService({
    store,
    runner,
    maxHistoryTurns: config.maxHistoryTurns,
  });

  return {
    service,
    health: () => ({
      status: "ok",
      knowledge: config.vaultRoot ? "configured" : "unavailable",
      model: config.model,
    }),
    close: () => store.close(),
  };
}

function createKnowledgeSource(config: AppConfig): KnowledgeSource {
  if (!config.vaultRoot) {
    return new UnavailableKnowledgeSource();
  }

  return new ObsidianKnowledgeSource({
    vaultRoot: config.vaultRoot,
    allowlist: config.vaultAllowlist,
  });
}
