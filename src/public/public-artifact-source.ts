import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  publicCareerEvidenceArtifactSchema,
  publicCareerEvidenceDigest,
  type PublicCareerEvidenceArtifact,
} from "../domain/public-career-evidence.js";

export interface PublicArtifactSource {
  read(): Promise<PublicCareerEvidenceArtifact | null>;
}

export class FilePublicArtifactSource implements PublicArtifactSource {
  constructor(private readonly artifactPath: string) {}

  async read(): Promise<PublicCareerEvidenceArtifact | null> {
    try {
      const serialized = await readFile(path.resolve(this.artifactPath), "utf8");
      const artifact = publicCareerEvidenceArtifactSchema.parse(
        JSON.parse(serialized),
      );
      const digest = publicCareerEvidenceDigest({
        evidence: artifact.evidence,
        revokedEvidenceIds: artifact.manifest.revokedEvidenceIds,
      });
      if (
        artifact.manifest.corpusHash !== `sha256:${digest}` ||
        artifact.manifest.corpusVersion !== `career:${digest}`
      ) {
        throw new PublicArtifactIntegrityError();
      }
      return artifact;
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        return null;
      }
      throw error;
    }
  }
}

export class PublicArtifactIntegrityError extends Error {
  constructor() {
    super("The public evidence artifact failed its integrity check.");
    this.name = "PublicArtifactIntegrityError";
  }
}
