import { promises as fs } from "node:fs";
import path from "node:path";

import { OpenAIJoleneRunner } from "./agent/agent-runner.js";
import { ActionApprovalService } from "./application/action-approval-service.js";
import { CapabilityInvocationAuditService } from
  "./application/capability-invocation-audit-service.js";
import { CapabilityInvocationAuditor } from
  "./application/capability-invocation-auditor.js";
import { CareerEvidenceService } from "./application/career-evidence-service.js";
import { ClientAiTaskPacketService } from "./application/client-ai-task-packet-service.js";
import { ContactIntentReviewService } from "./application/contact-intent-review-service.js";
import { PublicLiveModelReviewService } from "./application/public-live-model-review-service.js";
import { PersonalityResearchReviewService } from
  "./application/personality-research-review-service.js";
import { PersonalityTuningReviewService } from
  "./application/personality-tuning-review-service.js";
import { CareerRetrievalService } from "./application/career-retrieval-service.js";
import { JoleneService } from "./application/jolene-service.js";
import { KnowledgeAuditService } from "./application/knowledge-audit-service.js";
import { PersonalWorkflowService } from "./application/personal-workflow-service.js";
import { PrivateBriefingService } from "./application/private-briefing-service.js";
import { CanonicalPrivateBriefingSource } from "./application/private-briefing-source.js";
import {
  OwnerWatchedProjectSource,
} from "./application/private-watched-project-source.js";
import { WorkContextService } from "./application/work-context-service.js";
import { WorkStatusService } from "./application/work-status-service.js";
import { WatchedProjectService } from "./application/watched-project-service.js";
import { WatchedProjectMonitorService } from "./application/watched-project-monitor-service.js";
import { WatchedProjectNotificationService } from "./application/watched-project-notification-service.js";
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
import { SqliteCapabilityInvocationStore } from
  "./persistence/sqlite-capability-invocation-store.js";
import { SqliteCareerEvidenceStore } from "./persistence/sqlite-career-evidence-store.js";
import { SqliteCareerRetrievalAuditStore } from "./persistence/sqlite-career-retrieval-audit-store.js";
import { SqliteCareerRetrievalIndex } from "./persistence/sqlite-career-retrieval-index.js";
import { SqliteClientAiTaskPacketStore } from "./persistence/sqlite-client-ai-task-packet-store.js";
import { SqliteKnowledgeAccessStore } from "./persistence/sqlite-knowledge-access-store.js";
import { SqlitePersonalWorkflowStore } from "./persistence/sqlite-personal-workflow-store.js";
import { SqlitePrivateBriefingStore } from "./persistence/sqlite-private-briefing-store.js";
import { SqliteWorkContextStore } from "./persistence/sqlite-work-context-store.js";
import { SqliteWatchedProjectMonitorStore } from "./persistence/sqlite-watched-project-monitor-store.js";
import { FilePublicLiveModelReviewStore } from "./persistence/file-public-live-model-review-store.js";
import { FilePersonalityResearchReviewStore } from
  "./persistence/file-personality-research-review-store.js";
import { FilePersonalityTuningStore } from
  "./persistence/file-personality-tuning-store.js";
import { loadPersonalityResearch } from "./personality/personality-research.js";
import { LocalWatchedProjectInspector } from "./projects/local-watched-project-inspector.js";
import { FilePublicContactIntentQueue } from "./public/public-contact-intent-queue.js";

export interface JoleneApplication {
  readonly service: JoleneService;
  readonly deliveries: DeliveryStore;
  readonly work: WorkContextService;
  readonly knowledgeAudit: KnowledgeAuditService;
  readonly capabilityInvocations: CapabilityInvocationAuditService;
  readonly actionApprovals: ActionApprovalService;
  readonly careerEvidence: CareerEvidenceService;
  readonly careerRetrieval: CareerRetrievalService;
  readonly clientAiPackets: ClientAiTaskPacketService;
  readonly contactIntents: ContactIntentReviewService;
  readonly publicLiveModelReview: PublicLiveModelReviewService;
  readonly personalityResearchReview: PersonalityResearchReviewService;
  readonly personalityTuningReview: PersonalityTuningReviewService;
  readonly workflows: PersonalWorkflowService;
  readonly watchedProjects: WatchedProjectService;
  readonly projectMonitoring: WatchedProjectMonitorService;
  readonly projectNotifications: WatchedProjectNotificationService;
  readonly privateBriefing: PrivateBriefingService;
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
  const capabilityInvocationStore = new SqliteCapabilityInvocationStore(
    config.databasePath,
  );
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
  const projectInspector = new LocalWatchedProjectInspector();
  const watchedProjects = new WatchedProjectService(config.watchedProjects, projectInspector);
  const projectMonitorStore = new SqliteWatchedProjectMonitorStore(config.databasePath);
  const projectMonitoring = new WatchedProjectMonitorService(
    config.watchedProjects,
    projectInspector,
    projectMonitorStore,
  );
  const projectNotifications = new WatchedProjectNotificationService(
    config.watchedProjects,
    projectMonitorStore,
  );
  const ownerScope = {
    actorId: config.ownerActorId,
    workspaceId: config.ownerWorkspaceId,
  };
  const personalityResearchStore = new FilePersonalityResearchReviewStore(
    config.personalityResearchDecisionPath,
  );
  const contactQueue = new FilePublicContactIntentQueue({
    filePath: config.contactQueuePath,
    maxEntries: config.contactQueueMaxEntries,
    retentionMilliseconds: config.contactRetentionDays * 24 * 60 * 60 * 1_000,
  });
  await contactQueue.initialize();
  const workStatus = new WorkStatusService(workStore, personalWorkflowStore);
  const actionApprovals = new ActionApprovalService(actionApprovalStore, workStore);
  const clientAiPackets = new ClientAiTaskPacketService(
    new SqliteClientAiTaskPacketStore(config.databasePath),
    workStore,
    actionApprovals,
    ownerScope,
  );
  const privateBriefing = new PrivateBriefingService(
    config.privateBriefing,
    new SqlitePrivateBriefingStore(config.databasePath),
    new CanonicalPrivateBriefingSource(
      workStatus,
      projectMonitoring,
      actionApprovals,
    ),
    ownerScope,
  );
  const runner = new OpenAIJoleneRunner({
    apiKey: config.openaiApiKey,
    model: config.model,
    instructions,
    knowledge,
    careerKnowledge: careerRetrieval,
    workStatus,
    projectWatch: new OwnerWatchedProjectSource(watchedProjects, ownerScope),
    capabilityAudit: new CapabilityInvocationAuditor(capabilityInvocationStore),
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
    capabilityInvocations: new CapabilityInvocationAuditService(
      capabilityInvocationStore,
    ),
    actionApprovals,
    careerEvidence: new CareerEvidenceService(careerEvidenceStore, {
      actorId: config.careerOwnerActorId,
      workspaceId: config.careerWorkspaceId,
    }),
    careerRetrieval,
    clientAiPackets,
    contactIntents: new ContactIntentReviewService(contactQueue, ownerScope),
    publicLiveModelReview: new PublicLiveModelReviewService(
      new FilePublicLiveModelReviewStore({
        packetPath: config.publicLiveReviewPacketPath,
        decisionPath: config.publicLiveReviewDecisionPath,
      }),
      ownerScope,
    ),
    personalityResearchReview: new PersonalityResearchReviewService(
      () => loadPersonalityResearch(process.cwd()),
      personalityResearchStore,
      ownerScope,
    ),
    personalityTuningReview: new PersonalityTuningReviewService(
      () => loadPersonalityResearch(process.cwd()),
      personalityResearchStore,
      new FilePersonalityTuningStore(config.personalityTuningDecisionPath),
      ownerScope,
    ),
    workflows: new PersonalWorkflowService(personalWorkflowStore, workStore),
    watchedProjects,
    projectMonitoring,
    projectNotifications,
    privateBriefing,
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
      capabilityInvocationStore.close();
      careerEvidenceStore.close();
      careerRetrievalIndex.close();
      careerRetrievalAuditStore.close();
      clientAiPackets.close();
      personalWorkflowStore.close();
      privateBriefing.close();
      projectMonitoring.close();
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
