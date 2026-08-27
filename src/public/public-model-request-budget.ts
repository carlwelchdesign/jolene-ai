import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

const publicModelRequestBudgetStateSchema = z.object({
  schemaVersion: z.literal("jolene.public-model-request-budget.v1"),
  windowStartedAt: z.string().datetime({ offset: true }),
  requestCount: z.number().int().nonnegative(),
}).strict();

export interface PublicModelRequestBudget {
  reserve(): Promise<boolean>;
}

export interface InMemoryPublicModelRequestBudgetOptions {
  readonly maxRequestsPerWindow: number;
  readonly windowMilliseconds: number;
  readonly now?: () => Date;
}

/**
 * A best-effort per-runtime budget for ephemeral serverless processes.
 *
 * This is deliberately not represented as a global quota: every warm runtime
 * owns its own window. The authenticated BFF and delegate admission controls
 * remain the outer abuse boundary, while this budget prevents one warm
 * instance from issuing unbounded model requests.
 */
export class InMemoryPublicModelRequestBudget
  implements PublicModelRequestBudget
{
  readonly #maxRequestsPerWindow: number;
  readonly #windowMilliseconds: number;
  readonly #now: () => Date;
  #windowStartedAt: number;
  #requestCount = 0;

  constructor(options: InMemoryPublicModelRequestBudgetOptions) {
    if (
      !Number.isInteger(options.maxRequestsPerWindow) ||
      options.maxRequestsPerWindow < 1
    ) {
      throw new Error("Public model request limit must be a positive integer.");
    }
    if (
      !Number.isInteger(options.windowMilliseconds) ||
      options.windowMilliseconds < 1
    ) {
      throw new Error("Public model budget window must be a positive integer.");
    }
    this.#maxRequestsPerWindow = options.maxRequestsPerWindow;
    this.#windowMilliseconds = options.windowMilliseconds;
    this.#now = options.now ?? (() => new Date());
    this.#windowStartedAt = this.#now().getTime();
  }

  async reserve(): Promise<boolean> {
    const now = this.#now().getTime();
    if (now - this.#windowStartedAt >= this.#windowMilliseconds) {
      this.#windowStartedAt = now;
      this.#requestCount = 0;
    }
    if (this.#requestCount >= this.#maxRequestsPerWindow) return false;
    this.#requestCount += 1;
    return true;
  }
}

export interface FilePublicModelRequestBudgetOptions {
  readonly filePath: string;
  readonly maxRequestsPerWindow: number;
  readonly windowMilliseconds: number;
  readonly now?: () => Date;
}

export class FilePublicModelRequestBudget implements PublicModelRequestBudget {
  readonly #filePath: string;
  readonly #maxRequestsPerWindow: number;
  readonly #windowMilliseconds: number;
  readonly #now: () => Date;
  #pendingOperation: Promise<void> = Promise.resolve();

  constructor(options: FilePublicModelRequestBudgetOptions) {
    if (
      !Number.isInteger(options.maxRequestsPerWindow) ||
      options.maxRequestsPerWindow < 1
    ) {
      throw new Error("Public model request limit must be a positive integer.");
    }
    if (
      !Number.isInteger(options.windowMilliseconds) ||
      options.windowMilliseconds < 1
    ) {
      throw new Error("Public model budget window must be a positive integer.");
    }
    this.#filePath = path.resolve(options.filePath);
    this.#maxRequestsPerWindow = options.maxRequestsPerWindow;
    this.#windowMilliseconds = options.windowMilliseconds;
    this.#now = options.now ?? (() => new Date());
  }

  async initialize(): Promise<void> {
    await mkdir(path.dirname(this.#filePath), { recursive: true, mode: 0o700 });
    try {
      const current = await this.#read();
      const normalized = this.#currentWindow(current, this.#now());
      if (normalized !== current) await this.#write(normalized);
    } catch (error) {
      if (!isMissingFile(error)) throw new PublicModelBudgetUnavailableError();
      await this.#write(this.#emptyWindow(this.#now()));
    }
  }

  reserve(): Promise<boolean> {
    return this.#serialize(async () => {
      try {
        const current = this.#currentWindow(await this.#read(), this.#now());
        if (current.requestCount >= this.#maxRequestsPerWindow) {
          return false;
        }
        await this.#write({
          ...current,
          requestCount: current.requestCount + 1,
        });
        return true;
      } catch {
        throw new PublicModelBudgetUnavailableError();
      }
    });
  }

  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#pendingOperation.then(operation, operation);
    this.#pendingOperation = result.then(() => undefined, () => undefined);
    return result;
  }

  async #read(): Promise<z.infer<typeof publicModelRequestBudgetStateSchema>> {
    return publicModelRequestBudgetStateSchema.parse(
      JSON.parse(await readFile(this.#filePath, "utf8")),
    );
  }

  async #write(
    state: z.infer<typeof publicModelRequestBudgetStateSchema>,
  ): Promise<void> {
    const body = `${JSON.stringify(
      publicModelRequestBudgetStateSchema.parse(state),
      null,
      2,
    )}\n`;
    const temporaryPath = `${this.#filePath}.${process.pid}.tmp`;
    try {
      await writeFile(temporaryPath, body, { encoding: "utf8", mode: 0o600 });
      await rename(temporaryPath, this.#filePath);
    } catch {
      throw new PublicModelBudgetUnavailableError();
    }
  }

  #currentWindow(
    state: z.infer<typeof publicModelRequestBudgetStateSchema>,
    now: Date,
  ): z.infer<typeof publicModelRequestBudgetStateSchema> {
    return now.getTime() - Date.parse(state.windowStartedAt) >=
        this.#windowMilliseconds
      ? this.#emptyWindow(now)
      : state;
  }

  #emptyWindow(
    now: Date,
  ): z.infer<typeof publicModelRequestBudgetStateSchema> {
    return {
      schemaVersion: "jolene.public-model-request-budget.v1",
      windowStartedAt: now.toISOString(),
      requestCount: 0,
    };
  }
}

export class PublicModelBudgetUnavailableError extends Error {
  constructor() {
    super("The public model request budget is unavailable.");
    this.name = "PublicModelBudgetUnavailableError";
  }
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
