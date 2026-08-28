import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import {
  OpenAIJoleneRunner,
  type AgentRequest,
  type OpenAIJoleneRunnerOptions,
} from "../src/agent/agent-runner.js";
import { resolveChannelRetrievalPolicy } from "../src/domain/channel-retrieval-policy.js";
import {
  CapabilityInvocationAuditor,
  CapabilityInvocationAuditUnavailableError,
} from "../src/application/capability-invocation-auditor.js";
import { CapabilityContextError } from
  "../src/domain/capability-registry.js";
import {
  createToolIntentAuthorization,
  IntentBoundToolAuthorizer,
} from "../src/domain/tool-call-authorization.js";
import type {
  CapabilityAuthorizationRecord,
  CapabilityInvocationRecord,
  CapabilityInvocationStore,
  ListCapabilityInvocationsInput,
  RecordCapabilityAuthorizationInput,
  RecordCapabilityInvocationInput,
} from "../src/domain/capability-invocation.js";
import { SqliteCapabilityInvocationStore } from
  "../src/persistence/sqlite-capability-invocation-store.js";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true })
  ));
});

describe("capability invocation audit", () => {
  it("persists completed and failed calls without inputs, results, or errors", async () => {
    const databasePath = await tempDatabase();
    const store = new SqliteCapabilityInvocationStore(
      databasePath,
      () => new Date("2026-08-27T05:30:00.000Z"),
    );
    const auditor = new CapabilityInvocationAuditor(store);
    const context = invocationContext();
    const authorizer = intentAuthorizer();

    auditor.authorize(
      "knowledge.search",
      context,
      authorizer,
      { query: "approved project context", limit: 3 },
      "2026-08-27T05:30:00.000Z",
    );

    await expect(auditor.execute(
      "knowledge.search",
      context,
      async () => "Private result prose",
    )).resolves.toBe("Private result prose");
    await expect(auditor.execute(
      "work_status.review",
      context,
      async () => {
        throw new Error("Sensitive provider exception");
      },
    )).rejects.toThrow("Sensitive provider exception");
    auditor.recordFailure("work_status.review", context);
    store.close();

    const restarted = new SqliteCapabilityInvocationStore(databasePath);
    try {
      const records = restarted.listInvocations({
        actorId: "carl",
        workspaceId: "personal",
        eventId: "event-capability-1",
        limit: 20,
      });
      expect(records.map(({ outcome }) => outcome).sort())
        .toEqual(["completed", "failed"]);
      const serialized = JSON.stringify(records);
      expect(serialized).not.toContain("Private result prose");
      expect(serialized).not.toContain("Sensitive provider exception");
      expect(serialized).not.toContain("query");
      expect(serialized).not.toContain("channel-private-id");
      expect(serialized).not.toContain("thread-private-id");
      const authorizationRecords = restarted.listAuthorizations({
        actorId: "carl",
        workspaceId: "personal",
        eventId: "event-capability-1",
        limit: 20,
      });
      expect(authorizationRecords).toMatchObject([{
        capabilityId: "knowledge.search",
        toolName: "search_obsidian",
        outcome: "allowed",
        reasonCode: null,
      }]);
      const serializedAuthorizations = JSON.stringify(authorizationRecords);
      expect(serializedAuthorizations).not.toContain("approved project context");
      expect(serializedAuthorizations).not.toContain("Private result prose");
      expect(serializedAuthorizations).not.toContain("channel-private-id");
      expect(serializedAuthorizations).not.toContain("thread-private-id");
    } finally {
      restarted.close();
    }

    const database = new Database(databasePath, { readonly: true });
    try {
      const columns = database.pragma(
        "table_info(capability_invocations)",
      ) as Array<{ readonly name: string }>;
      expect(columns.map(({ name }) => name)).toEqual([
        "id",
        "event_id",
        "actor_id",
        "workspace_id",
        "capability_id",
        "tool_name",
        "outcome",
        "created_at",
      ]);
      const authorizationColumns = database.pragma(
        "table_info(capability_authorizations)",
      ) as Array<{ readonly name: string }>;
      expect(authorizationColumns.map(({ name }) => name)).toEqual([
        "id",
        "event_id",
        "actor_id",
        "workspace_id",
        "capability_id",
        "tool_name",
        "outcome",
        "reason_code",
        "authorization_id",
        "arguments_fingerprint",
        "created_at",
      ]);
    } finally {
      database.close();
    }
  });

  it("fails closed when a successful private tool call cannot be audited", async () => {
    const auditor = new CapabilityInvocationAuditor(new FailingStore());
    let returned = false;
    await expect(auditor.execute(
      "knowledge.search",
      invocationContext(),
      async () => {
        returned = true;
        return "private result";
      },
    )).rejects.toThrow(CapabilityInvocationAuditUnavailableError);
    expect(returned).toBe(true);
  });

  it("enforces registry context before calling the operation", async () => {
    const store = new SqliteCapabilityInvocationStore(":memory:");
    const auditor = new CapabilityInvocationAuditor(store);
    let called = false;
    try {
      await expect(auditor.execute(
        "knowledge.search",
        { ...invocationContext(), channelKind: "slack_shared" },
        () => {
          called = true;
          return "not allowed";
        },
      )).rejects.toThrow(CapabilityContextError);
      expect(called).toBe(false);
      expect(store.listInvocations({
        actorId: "carl",
        workspaceId: "personal",
        limit: 20,
      })).toEqual([]);
    } finally {
      store.close();
    }
  });

  it("audits SDK-rejected invalid model arguments without retaining them", async () => {
    const store = new SqliteCapabilityInvocationStore(":memory:");
    const runner = new OpenAIJoleneRunner({
      capabilityAudit: new CapabilityInvocationAuditor(store),
    } as unknown as OpenAIJoleneRunnerOptions);
    const privateRunner = runner as unknown as {
      createKnowledgeTool(request: AgentRequest): {
        invoke(context: unknown, input: string): Promise<unknown>;
      };
    };
    const knowledgeTool = privateRunner.createKnowledgeTool(agentRequest());
    try {
      await expect(knowledgeTool.invoke(
        {},
        JSON.stringify({ query: "x", limit: 3 }),
      )).resolves.toBe("The private capability could not be completed.");
      const records = store.listInvocations({
        actorId: "carl",
        workspaceId: "personal",
        limit: 20,
      });
      expect(records).toMatchObject([{
        capabilityId: "knowledge.search",
        toolName: "search_obsidian",
        outcome: "failed",
      }]);
      expect(JSON.stringify(records)).not.toContain("private invalid x");
      expect(store.listAuthorizations({
        actorId: "carl",
        workspaceId: "personal",
        limit: 20,
      })).toMatchObject([{
        capabilityId: "knowledge.search",
        outcome: "denied",
        reasonCode: "argument_invalid",
        authorizationId: null,
        argumentsFingerprint: null,
      }]);
    } finally {
      store.close();
    }
  });

  it("audits a successful SDK model-tool invocation after private retrieval", async () => {
    const store = new SqliteCapabilityInvocationStore(":memory:");
    const runner = new OpenAIJoleneRunner({
      capabilityAudit: new CapabilityInvocationAuditor(store),
      knowledge: {
        async search() {
          return [];
        },
      },
    } as unknown as OpenAIJoleneRunnerOptions);
    const privateRunner = runner as unknown as {
      createKnowledgeTool(request: AgentRequest): {
        invoke(context: unknown, input: string): Promise<unknown>;
      };
    };
    const knowledgeTool = privateRunner.createKnowledgeTool(agentRequest());
    try {
      await expect(knowledgeTool.invoke(
        {},
        JSON.stringify({ query: "approved project context", limit: 3 }),
      )).resolves.toBe("[]");
      expect(store.listInvocations({
        actorId: "carl",
        workspaceId: "personal",
        limit: 20,
      })).toMatchObject([{
        capabilityId: "knowledge.search",
        toolName: "search_obsidian",
        outcome: "completed",
      }]);
      expect(store.listAuthorizations({
        actorId: "carl",
        workspaceId: "personal",
        limit: 20,
      })).toMatchObject([{
        capabilityId: "knowledge.search",
        outcome: "allowed",
        reasonCode: null,
        argumentsFingerprint: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
      }]);
    } finally {
      store.close();
    }
  });

  it("denies broadened and repeated calls before private source I/O", async () => {
    const store = new SqliteCapabilityInvocationStore(":memory:");
    let calls = 0;
    const runner = new OpenAIJoleneRunner({
      capabilityAudit: new CapabilityInvocationAuditor(store),
      knowledge: {
        async search() {
          calls += 1;
          return [];
        },
      },
    } as unknown as OpenAIJoleneRunnerOptions);
    const privateRunner = runner as unknown as {
      createKnowledgeTool(request: AgentRequest): {
        invoke(context: unknown, input: string): Promise<unknown>;
      };
    };
    const broadenedTool = privateRunner.createKnowledgeTool(agentRequest());
    try {
      await expect(broadenedTool.invoke(
        {},
        JSON.stringify({ query: "approved project passwords", limit: 3 }),
      )).resolves.toBe("The private capability could not be completed.");
      expect(calls).toBe(0);

      const repeatedTool = privateRunner.createKnowledgeTool(agentRequest());
      const exactInput = JSON.stringify({
        query: "approved project context",
        limit: 3,
      });
      await expect(repeatedTool.invoke({}, exactInput)).resolves.toBe("[]");
      await expect(repeatedTool.invoke({}, exactInput)).resolves.toBe(
        "The private capability could not be completed.",
      );
      expect(calls).toBe(1);
      expect(store.listAuthorizations({
        actorId: "carl",
        workspaceId: "personal",
        limit: 20,
      }).map((record) => [record.outcome, record.reasonCode])).toEqual([
        ["denied", "call_budget_exhausted"],
        ["allowed", null],
        ["denied", "argument_broadened"],
      ]);
    } finally {
      store.close();
    }
  });

  it("rejects tool names that disagree with the registry", () => {
    const store = new SqliteCapabilityInvocationStore(":memory:");
    try {
      expect(() => store.recordInvocation({
        eventId: "event-capability-1",
        actorId: "carl",
        workspaceId: "personal",
        capabilityId: "knowledge.search",
        toolName: "review_work_status",
        outcome: "completed",
      })).toThrow("does not match the registry");
    } finally {
      store.close();
    }
  });

  it("migrates an existing database without changing prior data or scope", async () => {
    const databasePath = await tempDatabase();
    const legacy = new Database(databasePath);
    legacy.exec(`
      CREATE TABLE existing_records (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO existing_records VALUES ('keep-me', 'preserved');
    `);
    legacy.close();

    const store = new SqliteCapabilityInvocationStore(databasePath);
    try {
      store.recordInvocation({
        eventId: "event-capability-1",
        actorId: "carl",
        workspaceId: "personal",
        capabilityId: "knowledge.search",
        toolName: "search_obsidian",
        outcome: "completed",
      });
      store.recordInvocation({
        eventId: "event-other",
        actorId: "jenny",
        workspaceId: "client",
        capabilityId: "knowledge.search",
        toolName: "search_obsidian",
        outcome: "completed",
      });
      expect(store.listInvocations({
        actorId: "carl",
        workspaceId: "personal",
        limit: 20,
      })).toHaveLength(1);
    } finally {
      store.close();
    }

    const verification = new Database(databasePath, { readonly: true });
    try {
      expect(verification.prepare(
        "SELECT value FROM existing_records WHERE id = 'keep-me'",
      ).get()).toEqual({ value: "preserved" });
    } finally {
      verification.close();
    }
  });
});

class FailingStore implements CapabilityInvocationStore {
  recordAuthorization(
    _input: RecordCapabilityAuthorizationInput,
  ): CapabilityAuthorizationRecord {
    throw new Error("Synthetic capability audit failure");
  }

  recordInvocation(
    _input: RecordCapabilityInvocationInput,
  ): CapabilityInvocationRecord {
    throw new Error("Synthetic capability audit failure");
  }

  listInvocations(
    _input: ListCapabilityInvocationsInput,
  ): readonly CapabilityInvocationRecord[] {
    return [];
  }

  listAuthorizations(
    _input: ListCapabilityInvocationsInput,
  ): readonly CapabilityAuthorizationRecord[] {
    return [];
  }

  close(): void {}
}

async function tempDatabase(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "jolene-capability-"));
  tempDirectories.push(directory);
  return path.join(directory, "jolene.sqlite");
}

function invocationContext() {
  return {
    eventId: "event-capability-1",
    actorId: "carl",
    workspaceId: "personal",
    channelKind: "private_chat" as const,
    channelId: "channel-private-id",
    threadId: "thread-private-id",
  };
}

function intentAuthorizer(): IntentBoundToolAuthorizer {
  return new IntentBoundToolAuthorizer(createToolIntentAuthorization({
    eventId: "event-capability-1",
    actorId: "carl",
    workspaceId: "personal",
    channelKind: "private_chat",
    channelId: "channel-private-id",
    threadId: "thread-private-id",
    disclosureCeiling: "local_private",
    currentMessage: "Search private knowledge for approved project context.",
    receivedAt: "2026-08-27T05:30:00.000Z",
    availableCapabilityIds: ["knowledge.search"],
  }));
}

function agentRequest(): AgentRequest {
  return {
    eventId: "event-capability-1",
    receivedAt: new Date().toISOString(),
    actorId: "carl",
    workspaceId: "personal",
    channelKind: "private_chat",
    channelId: "channel-private-id",
    threadId: "thread-private-id",
    message: "Search private knowledge for approved project context.",
    history: [],
    workContext: { task: null, taskEvents: [], memories: [] },
    workScope: null,
    retrievalPolicy: resolveChannelRetrievalPolicy({ surface: "private_chat" }),
  };
}
