import { mkdir, open, rename, rm } from "node:fs/promises";
import path from "node:path";

import type { PublicLiveModelReviewPacket } from
  "./public-live-model-evaluation.js";

export async function writePublicLiveModelReviewPacket(
  filePath: string,
  packet: PublicLiveModelReviewPacket,
): Promise<void> {
  const resolved = path.resolve(filePath);
  const directory = path.dirname(resolved);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporaryPath = `${resolved}.${process.pid}.tmp`;
  const handle = await open(temporaryPath, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(packet, null, 2)}\n`, "utf8");
    await handle.sync();
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  } finally {
    await handle.close();
  }
  await rename(temporaryPath, resolved);
}
