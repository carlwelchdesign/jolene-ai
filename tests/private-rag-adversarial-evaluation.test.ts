import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  createPrivateRagTurnPolicy,
  gatePrivateRagProviderPayload,
} from "../src/application/private-rag-provider-gate.js";
import type { AgentRequest } from "../src/agent/agent-runner.js";
import {
  privateRagNamespaceSchema,
  privateRagProviderPayloadClassSchema,
  privateRagRiskSignalSchema,
  type PrivateRagNamespace,
} from "../src/domain/private-rag-policy.js";
import { resolveChannelRetrievalPolicy } from
  "../src/domain/channel-retrieval-policy.js";
import {
  createUntrustedContentEnvelope,
  untrustedContentOriginKindSchema,
  type UntrustedContentOriginKind,
} from "../src/domain/untrusted-content.js";

const fixtureSchema = z.object({
  schemaVersion: z.literal("jolene.private-rag-security-evaluation.v1"),
  cases: z.array(z.object({
    id: z.string().min(1),
    originKind: untrustedContentOriginKindSchema,
    namespace: privateRagNamespaceSchema,
    providerPayloadClass: privateRagProviderPayloadClassSchema,
    sourceId: z.string().min(1),
    fragments: z.array(z.string().min(1)).min(1),
    expected: z.object({
      provider: z.enum(["allow", "deny"]),
      signals: z.array(privateRagRiskSignalSchema),
    }).strict(),
  }).strict()).min(20),
}).strict();

const suite = fixtureSchema.parse(JSON.parse(readFileSync(
  new URL("../evaluations/private-rag-security-v1.json", import.meta.url),
  "utf8",
)));

describe("private RAG adversarial and usefulness evaluation", () => {
  it("keeps case identifiers unique", () => {
    expect(new Set(suite.cases.map(({ id }) => id)).size)
      .toBe(suite.cases.length);
  });

  it.each(suite.cases)("enforces $id", (fixture) => {
    const envelopes = fixture.fragments.map((content, index) => envelope(
      fixture.originKind,
      `${fixture.sourceId}:${index}`,
      content,
    ));
    const expectedNamespace = namespaceForOrigin(fixture.originKind);
    const result = gatePrivateRagProviderPayload({
      policy: createPrivateRagTurnPolicy({
        request: request(),
        currentIntentFingerprint: `sha256:${"a".repeat(64)}`,
        namespaces: [expectedNamespace],
        origins: [fixture.originKind],
        classifications: ["private"],
        maxQueryTerms: 24,
        maxResultItems: 100,
        maxResultCharacters: 200_000,
        providerEgress: "approved_openai",
        providerPayloadClasses: [payloadClassForOrigin(fixture.originKind)],
      }),
      entries: envelopes.map((item) => ({
        namespace: fixture.namespace,
        envelope: item,
        providerPayloadClass: fixture.providerPayloadClass,
      })),
      queryTermCount: 3,
    });
    const signals = new Set(result.quarantineCandidates.flatMap(
      (candidate) => candidate.riskSignals,
    ));

    expect(result.providerEnvelopes.length > 0)
      .toBe(fixture.expected.provider === "allow");
    for (const expected of fixture.expected.signals) {
      expect(signals, `missing ${expected} for ${fixture.id}`).toContain(expected);
    }
    if (fixture.expected.provider === "allow") {
      expect(signals.size).toBe(0);
    }
  });
});

function envelope(
  originKind: UntrustedContentOriginKind,
  sourceId: string,
  content: string,
) {
  return createUntrustedContentEnvelope({
    origin: { kind: originKind, sourceId },
    scope: {
      actorId: "carl",
      workspaceId: "personal",
      channelKind: "private_chat",
      channelId: "channel-1",
      threadId: "thread-1",
    },
    classification: "private",
    purpose: "retrieval_evidence",
    disclosureCeiling: "owner_only",
    review: { status: "approved", reviewedAt: "2026-08-27T16:00:00.000Z" },
    freshness: {
      observedAt: "2026-08-27T16:00:00.000Z",
      expiresAt: null,
      status: "fresh",
    },
    revocation: { status: "active", revokedAt: null, reasonCode: null },
    payload: { kind: "text", text: content },
  });
}

function namespaceForOrigin(origin: UntrustedContentOriginKind): PrivateRagNamespace {
  switch (origin) {
    case "obsidian_excerpt": return "obsidian.personal";
    case "career_evidence":
    case "recommendation": return "career_evidence";
    case "conversation_quotation": return "conversation_history";
    case "durable_memory": return "durable_memory";
    case "task_event": return "task_context";
    case "project_snapshot": return "project_snapshot";
    case "tool_result": return "tool_result";
    case "external_ai_text": return "external_ai";
    default: throw new Error(`Unsupported fixture origin: ${origin}`);
  }
}

function payloadClassForOrigin(origin: UntrustedContentOriginKind) {
  switch (origin) {
    case "obsidian_excerpt": return "reviewed_excerpt" as const;
    case "career_evidence":
    case "recommendation": return "reviewed_career_claim" as const;
    case "conversation_quotation": return "conversation_context" as const;
    case "durable_memory":
    case "task_event": return "work_context" as const;
    case "project_snapshot":
    case "tool_result":
    case "external_ai_text": return "tool_observation" as const;
    default: throw new Error(`Unsupported fixture origin: ${origin}`);
  }
}

function request(): AgentRequest {
  return {
    eventId: "event-1",
    receivedAt: "2026-08-27T17:00:00.000Z",
    actorId: "carl",
    workspaceId: "personal",
    channelKind: "private_chat",
    channelId: "channel-1",
    threadId: "thread-1",
    message: "Use my saved context to answer this question.",
    history: [],
    workContext: { task: null, taskEvents: [], memories: [] },
    workScope: null,
    retrievalPolicy: resolveChannelRetrievalPolicy({ surface: "private_chat" }),
  };
}
