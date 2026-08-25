import { promises as fs } from "node:fs";
import path from "node:path";

import { OpenAIJoleneRunner } from "./agent/agent-runner.js";
import { ActionApprovalService } from "./application/action-approval-service.js";
import { JoleneService } from "./application/jolene-service.js";
import { KnowledgeAuditService } from "./application/knowledge-audit-service.js";
import { PersonalWorkflowService } from "./application/personal-workflow-service.js";
import { WorkContextService } from "./application/work-context-service.js";
import type { AppConfig } from "./config.js";
import type { DeliveryStore } from "./domain/delivery.js";
import {
  type KnowledgeSource,
  UnavailableKnowledgeSource,
} from "./knowledge/knowledge-source.js";
import { ObsidianKnowledgeSource } from "./knowledge/obsidian-source.js";
import { AuditedKnowledgeSource } from "./knowledge/audited-knowledge-source.js";
import { SqliteConversationStore } from "./persistence/sqlite-conversation-store.js";
import { SqliteActionApprovalStore } from "./persistence/sqlite-action-approval-store.js";
import { SqliteKnowledgeAccessStore } from "./persistence/sqlite-knowledge-access-store.js";
import { SqlitePersonalWorkflowStore } from "./persistence/sqlite-personal-workflow-store.js";
import { SqliteWorkContextStore } from "./persistence/sqlite-work-context-store.js";

export interface JoleneApplication {
  readonly service: JoleneService;
  readonly deliveries: DeliveryStore;
  readonly work: WorkContextService;
  readonly knowledgeAudit: KnowledgeAuditService;
  readonly actionApprovals: ActionApprovalService;
  readonly workflows: PersonalWorkflowService;
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
  const workStore = new SqliteWorkContextStore(config.databasePath);
  const knowledgeAuditStore = new SqliteKnowledgeAccessStore(config.databasePath);
  const actionApprovalStore = new SqliteActionApprovalStore(config.databasePath);
  const personalWorkflowStore = new SqlitePersonalWorkflowStore(config.databasePath);
  const knowledge = new AuditedKnowledgeSource(
    createKnowledgeSource(config),
    knowledgeAuditStore,
  );
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
    workContext: workStore,
    maxHistoryTurns: config.maxHistoryTurns,
    maxMemoryItems: config.maxMemoryItems,
  });

  return {
    service,
    deliveries: store,
    work: new WorkContextService(workStore),
    knowledgeAudit: new KnowledgeAuditService(knowledgeAuditStore),
    actionApprovals: new ActionApprovalService(actionApprovalStore, workStore),
    workflows: new PersonalWorkflowService(personalWorkflowStore, workStore),
    health: () => ({
      status: "ok",
      knowledge: config.vaultRoot ? "configured" : "unavailable",
      model: config.model,
    }),
    close: () => {
      store.close();
      workStore.close();
      knowledgeAuditStore.close();
      actionApprovalStore.close();
      personalWorkflowStore.close();
    },
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
