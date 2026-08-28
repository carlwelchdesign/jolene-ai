import { mkdir, open, rename, rm } from "node:fs/promises";
import path from "node:path";

import type { PublicLiveModelReviewPacket } from
  "./public-live-model-evaluation.js";
import type { PublicLiveModelEvaluationReport } from
  "./public-live-model-evaluation.js";

export async function writePublicLiveModelReviewPacket(
  filePath: string,
  packet: PublicLiveModelReviewPacket,
): Promise<void> {
  await writeOwnerOnlyJson(filePath, packet);
}

export async function writePublicLiveModelMachineReport(
  filePath: string,
  report: PublicLiveModelEvaluationReport,
): Promise<void> {
  await writeOwnerOnlyJson(filePath, report);
}

async function writeOwnerOnlyJson(
  filePath: string,
  value: unknown,
): Promise<void> {
  const resolved = path.resolve(filePath);
  const directory = path.dirname(resolved);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporaryPath = `${resolved}.${process.pid}.tmp`;
  const handle = await open(temporaryPath, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  } finally {
    await handle.close();
  }
  await rename(temporaryPath, resolved);
}
