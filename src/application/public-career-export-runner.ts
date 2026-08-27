import path from "node:path";

import { PublicCareerExportService } from "./public-career-export-service.js";
import { SqliteCareerEvidenceStore } from "../persistence/sqlite-career-evidence-store.js";
import {
  readPublicCareerArtifact,
  writePublicCareerArtifact,
} from "../publication/public-career-artifact-writer.js";

export interface PublicCareerExportRunInput {
  readonly actorId: string;
  readonly databasePath: string;
  readonly outputPath: string;
  readonly workspaceId: string;
}

export interface PublicCareerExportRunResult {
  readonly outputPath: string;
  readonly schemaVersion: string;
  readonly corpusVersion: string;
  readonly corpusHash: string;
  readonly generatedAt: string;
  readonly reviewedAt: string | null;
  readonly evidenceCount: number;
  readonly revokedEvidenceIds: readonly string[];
}

export async function runPublicCareerExport(
  input: PublicCareerExportRunInput,
): Promise<PublicCareerExportRunResult> {
  const databasePath = path.resolve(input.databasePath);
  const outputPath = path.resolve(input.outputPath);
  const store = new SqliteCareerEvidenceStore(
    databasePath,
    () => new Date(),
    { readOnly: true },
  );

  try {
    const previous = await readPublicCareerArtifact(outputPath);
    const artifact = new PublicCareerExportService(store).generate({
      actorId: input.actorId,
      workspaceId: input.workspaceId,
    }, previous);
    await writePublicCareerArtifact(outputPath, artifact);
    return {
      outputPath,
      ...artifact.manifest,
    };
  } finally {
    store.close();
  }
}
