import { loadConfig } from "./config.js";
import { UnavailableCareerEmbeddingProvider } from "./knowledge/openai-career-embeddings.js";
import { SqliteCareerEvidenceStore } from "./persistence/sqlite-career-evidence-store.js";
import { SqliteCareerRetrievalIndex } from "./persistence/sqlite-career-retrieval-index.js";

const config = loadConfig();

if (config.careerEmbeddingsEnabled) {
  throw new Error(
    "Lexical-only career indexing refuses to run while career embeddings are enabled.",
  );
}

const evidence = new SqliteCareerEvidenceStore(config.databasePath);
const index = new SqliteCareerRetrievalIndex(
  config.databasePath,
  evidence,
  new UnavailableCareerEmbeddingProvider(),
);

try {
  const report = await index.synchronize({
    actorId: config.careerOwnerActorId,
    workspaceId: config.careerWorkspaceId,
  });
  if (
    report.embeddedChunkCount !== 0 ||
    report.lexicalOnlyChunkCount !== report.chunkCount
  ) {
    throw new Error("Lexical-only career indexing retained embedding data.");
  }

  process.stdout.write(`${JSON.stringify({
    mode: "lexical_only",
    ...report,
  }, null, 2)}\n`);
} finally {
  index.close();
  evidence.close();
}
