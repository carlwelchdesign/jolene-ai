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
      return validatePublicArtifact(candidate);
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

export interface HttpsPublicArtifactSourceOptions {
  readonly url: string;
  readonly expectedCorpusVersion: string;
  readonly timeoutMilliseconds: number;
  readonly maximumBytes?: number;
  readonly fetchImpl?: typeof fetch;
}

export class HttpsPublicArtifactSource implements PublicArtifactSource {
  private readonly maximumBytes: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: HttpsPublicArtifactSourceOptions) {
    this.maximumBytes = options.maximumBytes ?? 1_000_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async read(): Promise<PublicCareerEvidenceArtifact | null> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.options.timeoutMilliseconds,
    );
    try {
      const response = await this.fetchImpl(this.options.url, {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      });
      if (response.status === 404) return null;
      if (!response.ok) throw new PublicArtifactUnavailableError();
      if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
        throw new PublicArtifactIntegrityError();
      }
      const candidate = JSON.parse(
        await readBoundedResponse(response, this.maximumBytes),
      ) as unknown;
      const artifact = validatePublicArtifact(candidate);
      if (artifact.manifest.corpusVersion !== this.options.expectedCorpusVersion) {
        throw new PublicArtifactVersionMismatchError();
      }
      return artifact;
    } catch (error) {
      if (
        error instanceof PublicArtifactIntegrityError ||
        error instanceof PublicArtifactVersionMismatchError ||
        error instanceof PublicArtifactUnavailableError
      ) {
        throw error;
      }
      if (error instanceof SyntaxError) throw new PublicArtifactIntegrityError();
      throw new PublicArtifactUnavailableError();
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function validatePublicArtifact(
  candidate: unknown,
): PublicCareerEvidenceArtifact {
  if (hasUnsupportedSchemaVersion(candidate)) {
    throw new PublicArtifactVersionMismatchError();
  }
  const artifact = publicCareerEvidenceArtifactSchema.parse(candidate);
  const digest = publicCareerEvidenceDigest({
    evidence: artifact.evidence,
    revokedEvidenceIds: artifact.manifest.revokedEvidenceIds,
    conflicts: artifact.conflicts,
  });
  if (
    artifact.manifest.corpusHash !== `sha256:${digest}` ||
    artifact.manifest.corpusVersion !== `career:${digest}`
  ) {
    throw new PublicArtifactIntegrityError();
  }
  return artifact;
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

export class PublicArtifactUnavailableError extends Error {
  constructor() {
    super("The public evidence artifact is unavailable.");
    this.name = "PublicArtifactUnavailableError";
  }
}

async function readBoundedResponse(
  response: Response,
  maximumBytes: number,
): Promise<string> {
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength !== null &&
    (!/^\d+$/.test(declaredLength) || Number(declaredLength) > maximumBytes)
  ) {
    throw new PublicArtifactIntegrityError();
  }
  if (!response.body) throw new PublicArtifactIntegrityError();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel();
        throw new PublicArtifactIntegrityError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, totalBytes).toString("utf8");
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
