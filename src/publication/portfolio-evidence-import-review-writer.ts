import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  portfolioEvidenceImportReviewPacketSchema,
  type PortfolioEvidenceImportReviewPacket,
} from "../domain/portfolio-evidence-import-review.js";

export async function writePortfolioEvidenceImportReviewPacket(
  outputPath: string,
  packet: PortfolioEvidenceImportReviewPacket,
): Promise<void> {
  const validated = portfolioEvidenceImportReviewPacketSchema.parse(packet);
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

export async function readPortfolioEvidenceImportReviewPacket(
  inputPath: string,
): Promise<PortfolioEvidenceImportReviewPacket> {
  return portfolioEvidenceImportReviewPacketSchema.parse(
    JSON.parse(await readFile(path.resolve(inputPath), "utf8")),
  );
}
