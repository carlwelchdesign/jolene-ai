import { promises as fs } from "node:fs";
import path from "node:path";

import { OpenAIJoleneRunner } from "./agent/agent-runner.js";
import { ActionApprovalService } from "./application/action-approval-service.js";
import { CareerEvidenceService } from "./application/career-evidence-service.js";
import { ContactIntentReviewService } from "./application/contact-intent-review-service.js";
import { CareerRetrievalService } from "./application/career-retrieval-service.js";
import { JoleneService } from "./application/jolene-service.js";
import { KnowledgeAuditService } from "./application/knowledge-audit-service.js";
import { PersonalWorkflowService } from "./application/personal-workflow-service.js";
import {
  OwnerWatchedProjectSource,
} from "./application/private-watched-project-source.js";
import { WorkContextService } from "./application/work-context-service.js";
import { WorkStatusService } from "./application/work-status-service.js";
import { WatchedProjectService } from "./application/watched-project-service.js";
import type { AppConfig } from "./config.js";
import type { DeliveryStore } from "./domain/delivery.js";
import { CanonicalPrivateWorkScopeResolver } from "./domain/private-work-scope.js";
import {
  type KnowledgeSource,
  UnavailableKnowledgeSource,
} from "./knowledge/knowledge-source.js";
import { ObsidianKnowledgeSource } from "./knowledge/obsidian-source.js";
import { AuditedKnowledgeSource } from "./knowledge/audited-knowledge-source.js";
import {
  createCareerEmbeddingProvider,
} from "./knowledge/openai-career-embeddings.js";
import { SqliteConversationStore } from "./persistence/sqlite-conversation-store.js";
import { SqliteActionApprovalStore } from "./persistence/sqlite-action-approval-store.js";
import { SqliteCareerEvidenceStore } from "./persistence/sqlite-career-evidence-store.js";
import { SqliteCareerRetrievalAuditStore } from "./persistence/sqlite-career-retrieval-audit-store.js";
import { SqliteCareerRetrievalIndex } from "./persistence/sqlite-career-retrieval-index.js";
import { SqliteKnowledgeAccessStore } from "./persistence/sqlite-knowledge-access-store.js";
import { SqlitePersonalWorkflowStore } from "./persistence/sqlite-personal-workflow-store.js";
import { SqliteWorkContextStore } from "./persistence/sqlite-work-context-store.js";
import { LocalWatchedProjectInspector } from "./projects/local-watched-project-inspector.js";
import { FilePublicContactIntentQueue } from "./public/public-contact-intent-queue.js";

export interface JoleneApplication {
  readonly service: JoleneService;
  readonly deliveries: DeliveryStore;
  readonly work: WorkContextService;
  readonly knowledgeAudit: KnowledgeAuditService;
  readonly actionApprovals: ActionApprovalService;
  readonly careerEvidence: CareerEvidenceService;
  readonly careerRetrieval: CareerRetrievalService;
  readonly contactIntents: ContactIntentReviewService;
  readonly workflows: PersonalWorkflowService;
  readonly watchedProjects: WatchedProjectService;
  readonly health: () => {
    readonly status: "ok";
    readonly knowledge: "configured" | "unavailable";
    readonly model: string;
    readonly watchedProjects: number;
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
  const careerEvidenceStore = new SqliteCareerEvidenceStore(config.databasePath);
  const careerRetrievalAuditStore = new SqliteCareerRetrievalAuditStore(
    config.databasePath,
  );
  const careerRetrievalIndex = new SqliteCareerRetrievalIndex(
    config.databasePath,
    careerEvidenceStore,
    createCareerEmbeddingProvider(
      config.careerEmbeddingsEnabled,
      config.embeddingModel,
    ),
  );
  const careerRetrieval = new CareerRetrievalService({
    index: careerRetrievalIndex,
    audit: careerRetrievalAuditStore,
    corpusScope: {
      actorId: config.careerOwnerActorId,
      workspaceId: config.careerWorkspaceId,
    },
    allowedActorIds: new Set([
      config.careerOwnerActorId,
      ...(config.slackOwnerUserId ? [config.slackOwnerUserId] : []),
    ]),
  });
  const personalWorkflowStore = new SqlitePersonalWorkflowStore(config.databasePath);
  const knowledge = new AuditedKnowledgeSource(
    createKnowledgeSource(config),
    knowledgeAuditStore,
  );
  const instructions = await fs.readFile(
    path.resolve(process.cwd(), "docs/prompt.md"),
    "utf8",
  );
  const watchedProjects = new WatchedProjectService(
    config.watchedProjects,
    new LocalWatchedProjectInspector(),
  );
  const ownerScope = {
    actorId: config.ownerActorId,
    workspaceId: config.ownerWorkspaceId,
  };
  const contactQueue = new FilePublicContactIntentQueue({
    filePath: config.contactQueuePath,
    maxEntries: config.contactQueueMaxEntries,
    retentionMilliseconds: config.contactRetentionDays * 24 * 60 * 60 * 1_000,
  });
  await contactQueue.initialize();
  const runner = new OpenAIJoleneRunner({
    model: config.model,
    instructions,
    knowledge,
    careerKnowledge: careerRetrieval,
    workStatus: new WorkStatusService(workStore, personalWorkflowStore),
    projectWatch: new OwnerWatchedProjectSource(watchedProjects, ownerScope),
  });
  const service = new JoleneService({
    store,
    runner,
    workContext: workStore,
    workScopeResolver: new CanonicalPrivateWorkScopeResolver({
      ownerScope,
      slackOwnerUserId: config.slackOwnerUserId,
    }),
    maxHistoryTurns: config.maxHistoryTurns,
    maxMemoryItems: config.maxMemoryItems,
  });

  return {
    service,
    deliveries: store,
    work: new WorkContextService(workStore),
    knowledgeAudit: new KnowledgeAuditService(knowledgeAuditStore),
    actionApprovals: new ActionApprovalService(actionApprovalStore, workStore),
    careerEvidence: new CareerEvidenceService(careerEvidenceStore, {
      actorId: config.careerOwnerActorId,
      workspaceId: config.careerWorkspaceId,
    }),
    careerRetrieval,
    contactIntents: new ContactIntentReviewService(contactQueue, ownerScope),
    workflows: new PersonalWorkflowService(personalWorkflowStore, workStore),
    watchedProjects,
    health: () => ({
      status: "ok",
      knowledge: config.vaultRoot ? "configured" : "unavailable",
      model: config.model,
      watchedProjects: config.watchedProjects.length,
    }),
    close: () => {
      store.close();
      workStore.close();
      knowledgeAuditStore.close();
      actionApprovalStore.close();
      careerEvidenceStore.close();
      careerRetrievalIndex.close();
      careerRetrievalAuditStore.close();
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
