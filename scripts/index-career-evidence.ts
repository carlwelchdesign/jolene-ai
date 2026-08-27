import { loadConfig } from "../src/config.js";
import { OpenAICareerEmbeddingProvider } from "../src/knowledge/openai-career-embeddings.js";
import { SqliteCareerEvidenceStore } from "../src/persistence/sqlite-career-evidence-store.js";
import { SqliteCareerRetrievalIndex } from "../src/persistence/sqlite-career-retrieval-index.js";

const config = loadConfig();
const evidence = new SqliteCareerEvidenceStore(config.databasePath);
const index = new SqliteCareerRetrievalIndex(
  config.databasePath,
  evidence,
  new OpenAICareerEmbeddingProvider(config.embeddingModel),
);

try {
  const report = await index.synchronize({
    actorId: config.careerOwnerActorId,
    workspaceId: config.careerWorkspaceId,
  });
  process.stdout.write(`${JSON.stringify({
    databasePath: config.databasePath,
    embeddingModel: config.embeddingModel,
    ...report,
  }, null, 2)}\n`);
} finally {
  index.close();
  evidence.close();
}
