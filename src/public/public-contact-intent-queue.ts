import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { PUBLIC_CAREER_EVIDENCE_SCHEMA_VERSION } from "../domain/public-career-evidence.js";
import {
  contactIntentRequestSchema,
  contactIntentResponseSchema,
  type ContactIntentRequest,
  type ContactIntentResponse,
} from "../domain/public-portfolio-contract.js";

const storedContactIntentSchema = contactIntentRequestSchema.extend({
  intentId: z.string().uuid(),
  status: z.literal("pending_review"),
  submittedAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
});

export const publicContactIntentQueueFileSchema = z.object({
  schemaVersion: z.literal(PUBLIC_CAREER_EVIDENCE_SCHEMA_VERSION),
  intents: z.array(storedContactIntentSchema),
}).strict();

export interface PublicContactIntentStager {
  stage(request: ContactIntentRequest): Promise<ContactIntentResponse>;
}

export interface FilePublicContactIntentQueueOptions {
  readonly filePath: string;
  readonly maxEntries: number;
  readonly retentionMilliseconds: number;
  readonly now?: () => number;
  readonly createId?: () => string;
}

export class FilePublicContactIntentQueue implements PublicContactIntentStager {
  readonly #filePath: string;
  readonly #maxEntries: number;
  readonly #retentionMilliseconds: number;
  readonly #now: () => number;
  readonly #createId: () => string;
  #pendingWrite: Promise<void> = Promise.resolve();

  constructor(options: FilePublicContactIntentQueueOptions) {
    if (!path.isAbsolute(options.filePath)) {
      throw new Error("Public contact queue path must be absolute.");
    }
    if (!Number.isInteger(options.maxEntries) || options.maxEntries < 1) {
      throw new Error("Public contact queue size must be a positive integer.");
    }
    if (
      !Number.isInteger(options.retentionMilliseconds) ||
      options.retentionMilliseconds < 1
    ) {
      throw new Error("Public contact retention must be a positive integer.");
    }
    this.#filePath = options.filePath;
    this.#maxEntries = options.maxEntries;
    this.#retentionMilliseconds = options.retentionMilliseconds;
    this.#now = options.now ?? Date.now;
    this.#createId = options.createId ?? randomUUID;
  }

  initialize(): Promise<void> {
    return this.#serialize(async () => {
      const now = this.#now();
      const loaded = await this.#read();
      const retained = this.#retained(loaded.intents, now).slice(
        -this.#maxEntries,
      );
      if (retained.length !== loaded.intents.length) {
        await this.#write(retained);
      }
    });
  }

  stage(request: ContactIntentRequest): Promise<ContactIntentResponse> {
    return this.#serialize(async () => {
      const validated = contactIntentRequestSchema.parse(request);
      const now = this.#now();
      const submittedAt = new Date(now).toISOString();
      const intentId = this.#createId();
      const record = storedContactIntentSchema.parse({
        ...validated,
        intentId,
        status: "pending_review",
        submittedAt,
        expiresAt: new Date(now + this.#retentionMilliseconds).toISOString(),
      });
      const loaded = await this.#read();
      const intents = [...this.#retained(loaded.intents, now), record].slice(
        -this.#maxEntries,
      );
      await this.#write(intents);
      return contactIntentResponseSchema.parse({
        schemaVersion: PUBLIC_CAREER_EVIDENCE_SCHEMA_VERSION,
        intentId,
        status: "pending_review",
        submittedAt,
        message: "Your contact request is queued for Carl's review.",
      });
    });
  }

  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#pendingWrite.then(operation, operation);
    this.#pendingWrite = result.then(() => undefined, () => undefined);
    return result;
  }

  async #read(): Promise<z.infer<typeof publicContactIntentQueueFileSchema>> {
    try {
      const value = JSON.parse(await readFile(this.#filePath, "utf8"));
      return publicContactIntentQueueFileSchema.parse(value);
    } catch (error) {
      if (isMissingFile(error)) {
        return {
          schemaVersion: PUBLIC_CAREER_EVIDENCE_SCHEMA_VERSION,
          intents: [],
        };
      }
      throw new PublicContactQueueUnavailableError();
    }
  }

  #retained(
    intents: readonly z.infer<typeof storedContactIntentSchema>[],
    now: number,
  ) {
    return intents.filter((intent) => Date.parse(intent.expiresAt) > now);
  }

  async #write(
    intents: readonly z.infer<typeof storedContactIntentSchema>[],
  ): Promise<void> {
    const directory = path.dirname(this.#filePath);
    const temporaryPath = `${this.#filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await chmod(directory, 0o700);
      await writeFile(
        temporaryPath,
        `${JSON.stringify({
          schemaVersion: PUBLIC_CAREER_EVIDENCE_SCHEMA_VERSION,
          intents,
        }, null, 2)}\n`,
        { encoding: "utf8", mode: 0o600 },
      );
      await rename(temporaryPath, this.#filePath);
      await chmod(this.#filePath, 0o600);
    } catch {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw new PublicContactQueueUnavailableError();
    }
  }
}

export class PublicContactQueueUnavailableError extends Error {
  constructor() {
    super("Public contact queue is unavailable.");
    this.name = "PublicContactQueueUnavailableError";
  }
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
