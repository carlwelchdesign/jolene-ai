import { chmod, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";

import {
  publicVoiceLabDecisionSchema,
  type PublicVoiceLabDecision,
} from "../domain/public-voice-lab-review.js";
import {
  publicVoiceLabCapturePacketSchema,
  type PublicVoiceLabCapturePacket,
} from "../evaluation/public-voice-lab-evaluation.js";
import type { ReviewFileState } from "./file-public-live-model-review-store.js";

export interface PublicVoiceLabReviewStore {
  readPacket(): Promise<ReviewFileState<PublicVoiceLabCapturePacket>>;
  readDecision(): Promise<ReviewFileState<PublicVoiceLabDecision>>;
  writeDecision(value: PublicVoiceLabDecision): Promise<void>;
}

export class FilePublicVoiceLabReviewStore implements PublicVoiceLabReviewStore {
  constructor(private readonly packetPath: string, private readonly decisionPath: string) {
    if (!path.isAbsolute(packetPath) || !path.isAbsolute(decisionPath)) {
      throw new Error("Public voice-lab review paths must be absolute.");
    }
  }

  readPacket() { return readValidated(this.packetPath, publicVoiceLabCapturePacketSchema.safeParse); }
  readDecision() { return readValidated(this.decisionPath, publicVoiceLabDecisionSchema.safeParse); }

  async writeDecision(value: PublicVoiceLabDecision): Promise<void> {
    const decision = publicVoiceLabDecisionSchema.parse(value);
    await mkdir(path.dirname(this.decisionPath), { recursive: true, mode: 0o700 });
    const temporary = `${this.decisionPath}.${process.pid}.${Date.now()}.tmp`;
    const handle = await open(temporary, "wx", 0o600);
    try { await handle.writeFile(`${JSON.stringify(decision, null, 2)}\n`); await handle.sync(); }
    catch (error) { await rm(temporary, { force: true }); throw error; }
    finally { await handle.close(); }
    await rename(temporary, this.decisionPath);
    await chmod(this.decisionPath, 0o600);
  }
}

async function readValidated<T>(filePath: string, validate: (value: unknown) => { readonly success: true; readonly data: T } | { readonly success: false }): Promise<ReviewFileState<T>> {
  try {
    const parsed = validate(JSON.parse(await readFile(filePath, "utf8")));
    return parsed.success ? { status: "ready", value: parsed.data } : { status: "malformed" };
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") return { status: "missing" };
    if (error instanceof SyntaxError) return { status: "malformed" };
    throw error;
  }
}
