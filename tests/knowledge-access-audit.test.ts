import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { KnowledgeAuditService } from "../src/application/knowledge-audit-service.js";
import { AuditedKnowledgeSource } from "../src/knowledge/audited-knowledge-source.js";
import type {
  KnowledgeAccessStore,
  RecordKnowledgeAccessInput,
  ListKnowledgeAccessInput,
  KnowledgeAccessRecord,
} from "../src/domain/knowledge-audit.js";
import type {
  KnowledgeSearchContext,
  KnowledgeSource,
} from "../src/knowledge/knowledge-source.js";
import { SqliteKnowledgeAccessStore } from "../src/persistence/sqlite-knowledge-access-store.js";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("knowledge access audit", () => {
  it("persists exact citations without retaining query text or excerpts", async () => {
    const databasePath = await tempDatabase();
    const store = new SqliteKnowledgeAccessStore(
      databasePath,
      () => new Date("2026-08-25T20:00:00.000Z"),
    );
    const source = new AuditedKnowledgeSource(
      successfulSource("Private excerpt that must not enter the ledger."),
      store,
    );

    await expect(
      source.search("Sensitive roadmap phrase", searchContext(), 5),
    ).resolves.toHaveLength(1);

    const access = store.listAccesses({
      actorId: "carl",
      workspaceId: "personal",
      eventId: "event-1",
      limit: 10,
    })[0];
    expect(access).toMatchObject({
      eventId: "event-1",
      status: "completed",
      resultCount: 1,
      errorCode: null,
      citations: [{
        notePath: "02 Projects/Jolene.md",
        heading: "Roadmap",
      }],
    });
    expect(access?.queryFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(access)).not.toContain("Sensitive roadmap phrase");
    expect(JSON.stringify(access)).not.toContain("Private excerpt");
    store.close();

    const database = new Database(databasePath, { readonly: true });
    try {
      const accessColumns = database.pragma("table_info(knowledge_accesses)") as Array<{ name: string }>;
      const citationColumns = database.pragma("table_info(knowledge_access_citations)") as Array<{ name: string }>;
      expect(accessColumns.map(({ name }) => name)).not.toContain("query");
      expect(citationColumns.map(({ name }) => name)).not.toContain("excerpt");
    } finally {
      database.close();
    }
  });

  it("records retrieval failures without returning private note content", async () => {
    const store = new SqliteKnowledgeAccessStore(":memory:");
    const source = new AuditedKnowledgeSource({
      async search() {
        throw new TypeError("Synthetic vault failure");
      },
    }, store);

    try {
      await expect(source.search("roadmap", searchContext())).rejects.toThrow(
        "Synthetic vault failure",
      );
      expect(store.listAccesses({
        actorId: "carl",
        workspaceId: "personal",
        limit: 10,
      })).toMatchObject([{
        status: "failed",
        resultCount: 0,
        errorCode: "typeerror",
        citations: [],
      }]);
    } finally {
      store.close();
    }
  });

  it("fails closed when a successful retrieval cannot be audited", async () => {
    const audit = new FailingAuditStore();
    const source = new AuditedKnowledgeSource(
      successfulSource("This content must remain inside the failed call."),
      audit,
    );

    await expect(source.search("roadmap", searchContext())).rejects.toThrow(
      "Synthetic audit failure",
    );
    expect(audit.attempts).toBe(2);
  });

  it("scopes audit review by actor, workspace, and optional event", async () => {
    const store = new SqliteKnowledgeAccessStore(":memory:");
    try {
      store.recordAccess(recordInput({ eventId: "event-one" }));
      store.recordAccess(recordInput({ eventId: "event-two" }));
      store.recordAccess(recordInput({ actorId: "jenny", eventId: "event-one" }));
      const service = new KnowledgeAuditService(store);

      expect(service.listAccesses({
        actorId: "carl",
        workspaceId: "personal",
        eventId: "event-one",
        limit: 20,
      })).toMatchObject([{ eventId: "event-one", actorId: "carl" }]);
      expect(service.listAccesses({
        actorId: "carl",
        workspaceId: "personal",
      })).toHaveLength(2);
      expect(() => service.listAccesses({
        actorId: "carl",
        workspaceId: "personal",
        limit: 201,
      })).toThrow();
    } finally {
      store.close();
    }
  });

  it("adds the ledger to an existing database without changing existing data", async () => {
    const databasePath = await tempDatabase();
    const legacy = new Database(databasePath);
    legacy.exec(`
      CREATE TABLE existing_records (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO existing_records VALUES ('keep-me', 'preserved');
    `);
    legacy.close();

    const store = new SqliteKnowledgeAccessStore(databasePath);
    store.recordAccess(recordInput());
    store.close();

    const migrated = new Database(databasePath, { readonly: true });
    try {
      expect(migrated.prepare(
        "SELECT value FROM existing_records WHERE id = 'keep-me'",
      ).get()).toEqual({ value: "preserved" });
      expect(migrated.prepare(
        "SELECT COUNT(*) AS count FROM knowledge_accesses",
      ).get()).toEqual({ count: 1 });
    } finally {
      migrated.close();
    }
  });

  it("rejects inconsistent audit records", () => {
    const store = new SqliteKnowledgeAccessStore(":memory:");
    try {
      expect(() => store.recordAccess({
        ...recordInput(),
        resultCount: 1,
        citations: [],
      })).toThrow("result count must match");
      expect(() => store.recordAccess({
        ...recordInput(),
        status: "failed",
        errorCode: null,
      })).toThrow("requires a bounded error");
    } finally {
      store.close();
    }
  });
});

class FailingAuditStore implements KnowledgeAccessStore {
  attempts = 0;

  recordAccess(_input: RecordKnowledgeAccessInput): KnowledgeAccessRecord {
    this.attempts += 1;
    throw new Error("Synthetic audit failure");
  }

  listAccesses(_input: ListKnowledgeAccessInput): readonly KnowledgeAccessRecord[] {
    return [];
  }

  close(): void {}
}

async function tempDatabase(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "jolene-audit-"));
  tempDirectories.push(directory);
  return path.join(directory, "jolene.sqlite");
}

function successfulSource(excerpt: string): KnowledgeSource {
  return {
    async search() {
      return [{
        namespace: "projects",
        notePath: "02 Projects/Jolene.md",
        heading: "Roadmap",
        excerpt,
        modifiedAt: "2026-08-25T19:00:00.000Z",
        score: 12,
      }];
    },
  };
}

function searchContext(): KnowledgeSearchContext {
  return {
    eventId: "event-1",
    actorId: "carl",
    workspaceId: "personal",
    channelIsPrivate: true,
    channelKind: "private_chat",
    channelId: "local",
    threadId: "main",
  };
}

function recordInput(overrides = {}) {
  return {
    eventId: "event-1",
    actorId: "carl",
    workspaceId: "personal",
    channelKind: "private_chat" as const,
    channelId: "local",
    threadId: "main",
    queryFingerprint: "a".repeat(64),
    status: "completed" as const,
    resultCount: 0,
    errorCode: null,
    citations: [],
    ...overrides,
  };
}
