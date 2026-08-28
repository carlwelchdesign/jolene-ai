import { chmod, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";

import {
  conversationalQualityDecisionSchema,
  type ConversationalQualityDecision,
} from "../domain/conversational-quality-review.js";
import {
  conversationalQualityCapturePacketSchema,
  type ConversationalQualityCapturePacket,
} from "../evaluation/conversational-quality-evaluation.js";
import type { ReviewFileState } from "./file-public-live-model-review-store.js";

export interface ConversationalQualityReviewStore {
  readPacket(): Promise<ReviewFileState<ConversationalQualityCapturePacket>>;
  readDecision(): Promise<ReviewFileState<ConversationalQualityDecision>>;
  writeDecision(decision: ConversationalQualityDecision): Promise<void>;
}

export class FileConversationalQualityReviewStore
  implements ConversationalQualityReviewStore
{
  constructor(
    private readonly packetPath: string,
    private readonly decisionPath: string,
  ) {
    if (!path.isAbsolute(packetPath) || !path.isAbsolute(decisionPath)) {
      throw new Error("Conversation-quality review paths must be absolute.");
    }
  }

  readPacket() {
    return readValidated(this.packetPath, conversationalQualityCapturePacketSchema.safeParse);
  }

  readDecision() {
    return readValidated(this.decisionPath, conversationalQualityDecisionSchema.safeParse);
  }

  async writeDecision(decision: ConversationalQualityDecision): Promise<void> {
    const validated = conversationalQualityDecisionSchema.parse(decision);
    await mkdir(path.dirname(this.decisionPath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.decisionPath}.${process.pid}.${Date.now()}.tmp`;
    const handle = await open(temporaryPath, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(validated, null, 2)}\n`, "utf8");
      await handle.sync();
    } catch (error) {
      await rm(temporaryPath, { force: true });
      throw error;
    } finally {
      await handle.close();
    }
    await rename(temporaryPath, this.decisionPath);
    await chmod(this.decisionPath, 0o600);
  }
}

async function readValidated<T>(
  filePath: string,
  validate: (value: unknown) =>
    | { readonly success: true; readonly data: T }
    | { readonly success: false },
): Promise<ReviewFileState<T>> {
  try {
    const result = validate(JSON.parse(await readFile(filePath, "utf8")));
    return result.success ? { status: "ready", value: result.data } : { status: "malformed" };
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT") return { status: "missing" };
    if (error instanceof SyntaxError) return { status: "malformed" };
    throw error;
  }
}
