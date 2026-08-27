import { chmod, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";

import {
  publicLiveModelHumanDecisionSchema,
  type PublicLiveModelHumanDecision,
} from "../domain/public-live-model-review.js";
import {
  publicLiveModelReviewPacketSchema,
  type PublicLiveModelReviewPacket,
} from "../evaluation/public-live-model-evaluation.js";

export type ReviewFileState<T> =
  | { readonly status: "ready"; readonly value: T }
  | { readonly status: "missing" }
  | { readonly status: "malformed" };

export interface PublicLiveModelReviewStore {
  readPacket(): Promise<ReviewFileState<PublicLiveModelReviewPacket>>;
  readDecision(): Promise<ReviewFileState<PublicLiveModelHumanDecision>>;
  writeDecision(decision: PublicLiveModelHumanDecision): Promise<void>;
}

export class FilePublicLiveModelReviewStore implements PublicLiveModelReviewStore {
  readonly #packetPath: string;
  readonly #decisionPath: string;

  constructor(options: { readonly packetPath: string; readonly decisionPath: string }) {
    this.#packetPath = requireAbsolute(options.packetPath, "review packet");
    this.#decisionPath = requireAbsolute(options.decisionPath, "review decision");
  }

  async readPacket(): Promise<ReviewFileState<PublicLiveModelReviewPacket>> {
    return readValidated(this.#packetPath, publicLiveModelReviewPacketSchema.safeParse);
  }

  async readDecision(): Promise<ReviewFileState<PublicLiveModelHumanDecision>> {
    return readValidated(this.#decisionPath, publicLiveModelHumanDecisionSchema.safeParse);
  }

  async writeDecision(decision: PublicLiveModelHumanDecision): Promise<void> {
    const validated = publicLiveModelHumanDecisionSchema.parse(decision);
    const directory = path.dirname(this.#decisionPath);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    const temporaryPath = `${this.#decisionPath}.${process.pid}.${Date.now()}.tmp`;
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
    await rename(temporaryPath, this.#decisionPath);
    await chmod(this.#decisionPath, 0o600);
  }
}

async function readValidated<T>(
  filePath: string,
  validate: (value: unknown) =>
    | { readonly success: true; readonly data: T }
    | { readonly success: false },
): Promise<ReviewFileState<T>> {
  try {
    const raw: unknown = JSON.parse(await readFile(filePath, "utf8"));
    const result = validate(raw);
    return result.success
      ? { status: "ready", value: result.data }
      : { status: "malformed" };
  } catch (error) {
    if (isMissing(error)) return { status: "missing" };
    if (error instanceof SyntaxError) return { status: "malformed" };
    throw error;
  }
}

function requireAbsolute(value: string, label: string): string {
  if (!path.isAbsolute(value)) {
    throw new Error(`Public live-model ${label} path must be absolute.`);
  }
  return path.resolve(value);
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT";
}
