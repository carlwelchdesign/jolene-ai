import { chmod, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";

import {
  personalityResearchDecisionSchema,
  type PersonalityResearchDecision,
} from "../domain/personality-research-review.js";

export type PersonalityDecisionFileState =
  | { readonly status: "ready"; readonly value: PersonalityResearchDecision }
  | { readonly status: "missing" }
  | { readonly status: "malformed" };

export interface PersonalityResearchReviewStore {
  readDecision(): Promise<PersonalityDecisionFileState>;
  writeDecision(decision: PersonalityResearchDecision): Promise<void>;
}

export class FilePersonalityResearchReviewStore
implements PersonalityResearchReviewStore {
  readonly #decisionPath: string;

  constructor(decisionPath: string) {
    if (!path.isAbsolute(decisionPath)) {
      throw new Error("Personality research decision path must be absolute.");
    }
    this.#decisionPath = path.resolve(decisionPath);
  }

  async readDecision(): Promise<PersonalityDecisionFileState> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.#decisionPath, "utf8"));
      const result = personalityResearchDecisionSchema.safeParse(parsed);
      return result.success
        ? { status: "ready", value: result.data }
        : { status: "malformed" };
    } catch (error) {
      if (error instanceof SyntaxError) return { status: "malformed" };
      if (error instanceof Error && "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT") {
        return { status: "missing" };
      }
      throw error;
    }
  }

  async writeDecision(decision: PersonalityResearchDecision): Promise<void> {
    const value = personalityResearchDecisionSchema.parse(decision);
    const directory = path.dirname(this.#decisionPath);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    const temporaryPath = `${this.#decisionPath}.${process.pid}.${Date.now()}.tmp`;
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
    await rename(temporaryPath, this.#decisionPath);
    await chmod(this.#decisionPath, 0o600);
  }
}
