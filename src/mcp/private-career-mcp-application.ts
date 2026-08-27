import { randomBytes } from "node:crypto";

import { CareerEvidenceService } from
  "../application/career-evidence-service.js";
import { CareerRetrievalService } from
  "../application/career-retrieval-service.js";
import type { CareerEmbeddingProvider } from
  "../domain/career-retrieval.js";
import { SqliteCareerEvidenceStore } from
  "../persistence/sqlite-career-evidence-store.js";
import { SqliteCareerRetrievalAuditStore } from
  "../persistence/sqlite-career-retrieval-audit-store.js";
import { SqliteCareerRetrievalIndex } from
  "../persistence/sqlite-career-retrieval-index.js";
import { SqlitePrivateCareerMcpAuditStore } from
  "../persistence/sqlite-private-career-mcp-audit-store.js";
import {
  assertPrivateCareerMcpDatabase,
  type PrivateCareerMcpConfig,
} from "./private-career-mcp-config.js";
import { PrivateCareerMcpService } from "./private-career-mcp-service.js";

export interface PrivateCareerMcpApplication {
  readonly service: PrivateCareerMcpService;
  readonly close: () => void;
}

export function createPrivateCareerMcpApplication(
  config: PrivateCareerMcpConfig,
  now: () => Date = () => new Date(),
): PrivateCareerMcpApplication {
  assertPrivateCareerMcpDatabase(config.databasePath);
  const scope = {
    actorId: config.actorId,
    workspaceId: config.workspaceId,
  };
  const evidenceStore = new SqliteCareerEvidenceStore(
    config.databasePath,
    now,
    { readOnly: true },
  );
  const retrievalAudit = new SqliteCareerRetrievalAuditStore(
    config.databasePath,
    now,
  );
  const retrievalIndex = new SqliteCareerRetrievalIndex(
    config.databasePath,
    evidenceStore,
    new RetainOnlyCareerEmbeddingProvider(),
    now,
  );
  const mcpAudit = new SqlitePrivateCareerMcpAuditStore(
    config.databasePath,
    now,
  );
  const evidence = new CareerEvidenceService(evidenceStore, scope);
  const retrieval = new CareerRetrievalService({
    index: retrievalIndex,
    audit: retrievalAudit,
    corpusScope: scope,
    allowedActorIds: new Set([config.actorId]),
    fingerprintKey: randomBytes(32),
  });

  return {
    service: new PrivateCareerMcpService({
      retrieval,
      evidence,
      audit: mcpAudit,
      scope,
      clientId: config.clientId,
      now,
      fingerprintKey: randomBytes(32),
    }),
    close: () => {
      retrievalIndex.close();
      retrievalAudit.close();
      mcpAudit.close();
      evidenceStore.close();
    },
  };
}

class RetainOnlyCareerEmbeddingProvider implements CareerEmbeddingProvider {
  readonly existingEmbeddingPolicy = "retain" as const;

  async embed(): Promise<null> {
    return null;
  }
}
