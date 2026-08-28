import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  contactIntentRequestSchema,
  contactIntentResponseSchema,
} from "../src/domain/public-portfolio-contract.js";
import {
  FilePublicContactIntentQueue,
  PublicContactQueueUnavailableError,
  publicContactIntentQueueFileSchema,
} from "../src/public/public-contact-intent-queue.js";
import { parseUntrustedContentEnvelope } from
  "../src/domain/untrusted-content.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    ),
  );
});

describe("FilePublicContactIntentQueue", () => {
  it("persists minimized consented data and returns a generic receipt", async () => {
    const filePath = await queuePath();
    const queue = createQueue(filePath);
    const response = await queue.stage(validRequest());

    expect(contactIntentResponseSchema.parse(response)).toEqual(response);
    expect(response).toEqual({
      schemaVersion: "1.0.0",
      intentId: "00000000-0000-4000-8000-000000000001",
      status: "pending_review",
      submittedAt: "2026-08-26T17:00:00.000Z",
      message: "Your contact request is queued for Carl's review.",
    });
    expect(JSON.stringify(response)).not.toContain("recruiter@example.com");
    expect(JSON.stringify(response)).not.toContain("Interview request");

    const stored = await readQueue(filePath);
    expect(stored.intents).toMatchObject([{
      ...validRequest(),
      intentId: response.intentId,
      status: "pending_review",
      submittedAt: response.submittedAt,
      expiresAt: "2026-09-25T17:00:00.000Z",
    }]);
    const envelope = parseUntrustedContentEnvelope(
      stored.intents[0]?.untrustedContent,
    );
    expect(envelope).toMatchObject({
      authority: "none",
      classification: "sensitive",
      disclosureCeiling: "no_disclosure",
      origin: { kind: "contact_submission" },
    });
    expect((await stat(path.dirname(filePath))).mode & 0o777).toBe(0o700);
    expect((await stat(filePath)).mode & 0o777).toBe(0o600);
  });

  it("preserves valid records across queue instances", async () => {
    const filePath = await queuePath();
    await createQueue(filePath).stage(validRequest());
    const restarted = createQueue(filePath, {
      id: "00000000-0000-4000-8000-000000000002",
    });

    await restarted.initialize();
    await restarted.stage({
      ...validRequest(),
      email: "second@example.com",
    });

    const stored = await readQueue(filePath);
    expect(stored.intents.map((intent) => intent.email)).toEqual([
      "recruiter@example.com",
      "second@example.com",
    ]);
  });

  it("persists review state and inert reply drafts across restart", async () => {
    const filePath = await queuePath();
    const queue = createQueue(filePath);
    const staged = await queue.stage(validRequest());
    const reviewed = await queue.markReviewed(
      staged.intentId,
      "2026-08-26T18:00:00.000Z",
    );
    expect(reviewed).toMatchObject({
      status: "reviewed",
      reviewedAt: "2026-08-26T18:00:00.000Z",
    });
    await queue.saveReplyDraft(
      staged.intentId,
      "Thank you. I would be glad to discuss the role.",
      "2026-08-26T18:05:00.000Z",
    );

    const restarted = createQueue(filePath);
    const [intent] = await restarted.list();
    expect(intent).toMatchObject({
      intentId: staged.intentId,
      status: "reviewed",
      replyDraft: "Thank you. I would be glad to discuss the role.",
      replyDraftUpdatedAt: "2026-08-26T18:05:00.000Z",
    });
  });

  it("deletes only an exact existing intent", async () => {
    const filePath = await queuePath();
    const queue = createQueue(filePath);
    const staged = await queue.stage(validRequest());

    await queue.delete(staged.intentId);
    expect(await queue.list()).toEqual([]);
    await expect(queue.delete(staged.intentId)).rejects.toMatchObject({
      name: "PublicContactIntentNotFoundError",
    });
  });

  it("enforces retention and queue-size bounds", async () => {
    const filePath = await queuePath();
    let now = Date.parse("2026-08-26T17:00:00.000Z");
    let sequence = 1;
    const queue = new FilePublicContactIntentQueue({
      filePath,
      maxEntries: 2,
      retentionMilliseconds: 1_000,
      now: () => now,
      createId: () => `00000000-0000-4000-8000-${String(sequence++).padStart(12, "0")}`,
    });
    await queue.stage({ ...validRequest(), email: "first@example.com" });
    now += 500;
    await queue.stage({ ...validRequest(), email: "second@example.com" });
    now += 700;
    await queue.stage({ ...validRequest(), email: "third@example.com" });
    await queue.stage({ ...validRequest(), email: "fourth@example.com" });

    const stored = await readQueue(filePath);
    expect(stored.intents.map((intent) => intent.email)).toEqual([
      "third@example.com",
      "fourth@example.com",
    ]);
  });

  it("prunes expired records during restart initialization", async () => {
    const filePath = await queuePath();
    let now = Date.parse("2026-08-26T17:00:00.000Z");
    const first = new FilePublicContactIntentQueue({
      filePath,
      maxEntries: 5,
      retentionMilliseconds: 1_000,
      now: () => now,
      createId: () => "00000000-0000-4000-8000-000000000001",
    });
    await first.stage(validRequest());
    now += 1_001;

    const restarted = new FilePublicContactIntentQueue({
      filePath,
      maxEntries: 5,
      retentionMilliseconds: 1_000,
      now: () => now,
    });
    await restarted.initialize();

    expect((await readQueue(filePath)).intents).toEqual([]);
  });

  it("serializes concurrent staging without dropping records", async () => {
    const filePath = await queuePath();
    let sequence = 1;
    const queue = new FilePublicContactIntentQueue({
      filePath,
      maxEntries: 20,
      retentionMilliseconds: 30 * 24 * 60 * 60 * 1_000,
      now: () => Date.parse("2026-08-26T17:00:00.000Z"),
      createId: () => `00000000-0000-4000-8000-${String(sequence++).padStart(12, "0")}`,
    });

    await Promise.all(Array.from({ length: 10 }, (_, index) =>
      queue.stage({
        ...validRequest(),
        email: `recruiter-${index}@example.com`,
      })
    ));

    const stored = await readQueue(filePath);
    expect(stored.intents).toHaveLength(10);
    expect(new Set(stored.intents.map((intent) => intent.intentId)).size).toBe(10);
  });

  it("fails closed for corrupt or unwritable queue state", async () => {
    const filePath = await queuePath();
    await createQueue(filePath).stage(validRequest());
    await writeFile(filePath, "{invalid", "utf8");
    await expect(createQueue(filePath).stage(validRequest())).rejects
      .toBeInstanceOf(PublicContactQueueUnavailableError);

    const directoryAsFile = path.join(await temporaryDirectory(), "blocked");
    await writeFile(directoryAsFile, "not a directory", "utf8");
    const blockedPath = path.join(directoryAsFile, "contacts.json");
    await expect(createQueue(blockedPath).stage(validRequest())).rejects
      .toBeInstanceOf(PublicContactQueueUnavailableError);
  });

  it("strictly validates consent, contact fields, and likely secrets", () => {
    expect(() => contactIntentRequestSchema.parse({
      ...validRequest(),
      consent: false,
    })).toThrow();
    expect(() => contactIntentRequestSchema.parse({
      ...validRequest(),
      email: "not-an-email",
    })).toThrow();
    expect(() => contactIntentRequestSchema.parse({
      ...validRequest(),
      name: "x".repeat(101),
    })).toThrow();
    expect(() => contactIntentRequestSchema.parse({
      ...validRequest(),
      message: "x".repeat(2_001),
    })).toThrow();
    expect(() => contactIntentRequestSchema.parse({
      ...validRequest(),
      message: `Here is a key: sk-${"a".repeat(32)}`,
    })).toThrow();
    expect(() => contactIntentRequestSchema.parse({
      ...validRequest(),
      extra: true,
    })).toThrow();
  });
});

function validRequest() {
  return {
    name: "Recruiter Name",
    email: "recruiter@example.com",
    organization: "Example Company",
    message: "Interview request for a product engineering role.",
    consent: true as const,
  };
}

function createQueue(
  filePath: string,
  overrides: { readonly id?: string } = {},
) {
  return new FilePublicContactIntentQueue({
    filePath,
    maxEntries: 500,
    retentionMilliseconds: 30 * 24 * 60 * 60 * 1_000,
    now: () => Date.parse("2026-08-26T17:00:00.000Z"),
    createId: () => overrides.id ?? "00000000-0000-4000-8000-000000000001",
  });
}

async function readQueue(filePath: string) {
  return publicContactIntentQueueFileSchema.parse(
    JSON.parse(await readFile(filePath, "utf8")),
  );
}

async function queuePath(): Promise<string> {
  return path.join(await temporaryDirectory(), "queue", "contacts.json");
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "jolene-contact-"));
  temporaryDirectories.push(directory);
  return directory;
}
