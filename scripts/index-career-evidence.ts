import { loadConfig } from "../src/config.js";
import { createCareerEmbeddingProvider } from "../src/knowledge/openai-career-embeddings.js";
import { SqliteCareerEvidenceStore } from "../src/persistence/sqlite-career-evidence-store.js";
import { SqliteCareerRetrievalIndex } from "../src/persistence/sqlite-career-retrieval-index.js";

const config = loadConfig();
const evidence = new SqliteCareerEvidenceStore(config.databasePath);
const index = new SqliteCareerRetrievalIndex(
  config.databasePath,
  evidence,
  createCareerEmbeddingProvider(
    config.careerEmbeddingsEnabled,
    config.embeddingModel,
  ),
);

try {
  const report = await index.synchronize({
    actorId: config.careerOwnerActorId,
    workspaceId: config.careerWorkspaceId,
  });
  process.stdout.write(`${JSON.stringify({
    databasePath: config.databasePath,
    embeddingsEnabled: config.careerEmbeddingsEnabled,
    embeddingModel: config.careerEmbeddingsEnabled
      ? config.embeddingModel
      : null,
    ...report,
  }, null, 2)}\n`);
} finally {
  index.close();
  evidence.close();
}
