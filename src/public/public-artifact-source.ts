import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  PUBLIC_CAREER_EVIDENCE_SCHEMA_VERSION,
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
      const candidate = JSON.parse(serialized) as unknown;
      if (hasUnsupportedSchemaVersion(candidate)) {
        throw new PublicArtifactVersionMismatchError();
      }
      const artifact = publicCareerEvidenceArtifactSchema.parse(candidate);
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

export class PublicArtifactVersionMismatchError extends Error {
  constructor() {
    super("The public evidence artifact uses an unsupported schema version.");
    this.name = "PublicArtifactVersionMismatchError";
  }
}

function hasUnsupportedSchemaVersion(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const manifest = (value as { readonly manifest?: unknown }).manifest;
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return false;
  }
  const schemaVersion = (manifest as { readonly schemaVersion?: unknown })
    .schemaVersion;
  return typeof schemaVersion === "string" &&
    schemaVersion !== PUBLIC_CAREER_EVIDENCE_SCHEMA_VERSION;
}
