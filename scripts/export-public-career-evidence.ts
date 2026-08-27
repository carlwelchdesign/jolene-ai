import path from "node:path";

import dotenv from "dotenv";

import { PublicCareerExportService } from "../src/application/public-career-export-service.js";
import { SqliteCareerEvidenceStore } from "../src/persistence/sqlite-career-evidence-store.js";
import {
  readPublicCareerArtifact,
  writePublicCareerArtifact,
} from "../src/publication/public-career-artifact-writer.js";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });

const databasePath = path.resolve(
  process.cwd(),
  process.env.JOLENE_DATABASE_PATH ?? ".jolene/jolene.sqlite",
);
const outputPath = path.resolve(
  process.cwd(),
  process.env.JOLENE_PUBLIC_CAREER_EXPORT_PATH ??
    ".jolene/exports/public-career-evidence.json",
);
const scope = {
  actorId: process.env.JOLENE_OWNER_ACTOR_ID ?? "carl",
  workspaceId: process.env.JOLENE_CAREER_WORKSPACE_ID ?? "professional",
};

const store = new SqliteCareerEvidenceStore(databasePath);
try {
  const previous = await readPublicCareerArtifact(outputPath);
  const artifact = new PublicCareerExportService(store).generate(scope, previous);
  await writePublicCareerArtifact(outputPath, artifact);
  process.stdout.write(`${JSON.stringify({
    outputPath,
    ...artifact.manifest,
  }, null, 2)}\n`);
} finally {
  store.close();
}
