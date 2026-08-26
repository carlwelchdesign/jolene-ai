import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  publicCareerEvidenceArtifactSchema,
  type PublicCareerEvidenceArtifact,
} from "../domain/public-career-evidence.js";

export async function writePublicCareerArtifact(
  outputPath: string,
  artifact: PublicCareerEvidenceArtifact,
): Promise<void> {
  const validated = publicCareerEvidenceArtifactSchema.parse(artifact);
  const resolved = path.resolve(outputPath);
  const directory = path.dirname(resolved);
  const temporary = path.join(
    directory,
    `.${path.basename(resolved)}.${process.pid}.${randomUUID()}.tmp`,
  );

  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    await writeFile(temporary, `${JSON.stringify(validated, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporary, resolved);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function readPublicCareerArtifact(
  inputPath: string,
): Promise<PublicCareerEvidenceArtifact | null> {
  try {
    const serialized = await readFile(path.resolve(inputPath), "utf8");
    return publicCareerEvidenceArtifactSchema.parse(JSON.parse(serialized));
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
