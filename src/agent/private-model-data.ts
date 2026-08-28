import type { AgentRequest } from "./agent-runner.js";
import type { CareerRetrievalResponse } from "../domain/career-retrieval.js";
import type { AuthorizedWorkContext } from "../domain/work-context.js";
import {
  createUntrustedContentEnvelope,
  serializeUntrustedContentEnvelope,
  type JsonValue,
  type UntrustedContentClassification,
  type UntrustedContentEnvelope,
  type UntrustedContentOriginKind,
  type UntrustedContentPurpose,
} from "../domain/untrusted-content.js";
import type { WatchedProjectSnapshot, WatchedProjectSummary } from
  "../domain/watched-project.js";
import type { WorkStatusSnapshot } from "../domain/work-status.js";
import type { KnowledgeResult } from "../knowledge/knowledge-source.js";

type PrivateModelScope = Pick<
  AgentRequest,
  "actorId" | "workspaceId" | "channelKind" | "channelId" | "threadId"
>;

export function serializePrivateRunData(request: AgentRequest): string {
  const envelopes: UntrustedContentEnvelope[] = [
    ...conversationEnvelopes(request),
    ...workContextEnvelopes(request.workContext, request),
    createPrivateEnvelope({
      originKind: "user_message",
      sourceId: `event:${request.eventId}:current-message`,
      request,
      purpose: "answer_context",
      classification: "private",
      payload: { kind: "text", text: request.message },
      observedAt: request.receivedAt,
    }),
  ];
  return serializeCollection(envelopes);
}

export function serializeKnowledgeToolResults(
  results: readonly KnowledgeResult[],
  request: AgentRequest,
  observedAt: string,
): string {
  return serializePrivateModelEnvelopes(knowledgeToolResultEnvelopes(
    results,
    request,
    observedAt,
  ));
}

export function knowledgeToolResultEnvelopes(
  results: readonly KnowledgeResult[],
  request: AgentRequest,
  observedAt: string,
): readonly UntrustedContentEnvelope[] {
  return results.map((result) => createPrivateEnvelope({
    originKind: "obsidian_excerpt",
    sourceId: `obsidian:${result.notePath}#${result.heading}`,
    request,
    purpose: "retrieval_evidence",
    classification: result.namespace === "personal" ? "sensitive" : "private",
    payload: { kind: "json", value: toJsonValue(result) },
    observedAt,
    reviewedAt: result.modifiedAt,
    freshnessStatus: "unknown",
  }));
}

export function serializeCareerToolResults(
  response: CareerRetrievalResponse,
  request: AgentRequest,
  observedAt: string,
): string {
  return serializePrivateModelEnvelopes(careerToolResultEnvelopes(
    response,
    request,
    observedAt,
  ));
}

export function careerToolResultEnvelopes(
  response: CareerRetrievalResponse,
  request: AgentRequest,
  observedAt: string,
): readonly UntrustedContentEnvelope[] {
  return response.results.map((result) => createPrivateEnvelope({
    originKind: result.citation.sourceTitle.toLocaleLowerCase("en-US")
        .includes("recommendation")
      ? "recommendation"
      : "career_evidence",
    sourceId: `${result.citation.sourceId}:${result.citation.claimId}`,
    request,
    purpose: "retrieval_evidence",
    classification: result.visibility === "public_approved" ? "public" : "internal",
    payload: {
      kind: "json",
      value: toJsonValue({ retrievalMode: response.mode, ...result }),
    },
    observedAt,
    reviewedAt: result.citation.reviewedAt,
    freshnessStatus: "fresh",
  }));
}

export function serializeWorkStatusToolResult(
  snapshot: WorkStatusSnapshot,
  request: AgentRequest,
  observedAt: string,
): string {
  return serializeCollection([createPrivateEnvelope({
    originKind: "tool_result",
    sourceId: `work-status:${request.eventId}`,
    request,
    purpose: "tool_observation",
    classification: "private",
    payload: { kind: "json", value: toJsonValue(snapshot) },
    observedAt,
  })]);
}

export function serializeWatchedProjectList(
  projects: readonly WatchedProjectSummary[],
  request: AgentRequest,
  observedAt: string,
): string {
  return serializeCollection(projects.map((project) => createPrivateEnvelope({
    originKind: "project_snapshot",
    sourceId: `watched-project:${project.id}:configuration`,
    request,
    purpose: "tool_observation",
    classification: "private",
    payload: { kind: "json", value: toJsonValue(project) },
    observedAt,
  })));
}

export function serializeWatchedProjectSnapshot(
  snapshot: WatchedProjectSnapshot,
  request: AgentRequest,
): string {
  return serializeCollection([createPrivateEnvelope({
    originKind: "project_snapshot",
    sourceId: `watched-project:${snapshot.id}:${snapshot.checkedAt}`,
    request,
    purpose: "tool_observation",
    classification: "private",
    payload: { kind: "json", value: toJsonValue(snapshot) },
    observedAt: snapshot.checkedAt,
    freshnessStatus: "fresh",
  })]);
}

function conversationEnvelopes(request: AgentRequest): UntrustedContentEnvelope[] {
  return request.history.map((turn) => createPrivateEnvelope({
    originKind: "conversation_quotation",
    sourceId: `conversation-turn:${turn.id}`,
    request,
    purpose: "conversation_continuity",
    classification: "private",
    payload: {
      kind: "json",
      value: { role: turn.role, content: turn.content, createdAt: turn.createdAt },
    },
    observedAt: turn.createdAt,
  }));
}

function workContextEnvelopes(
  context: AuthorizedWorkContext,
  request: AgentRequest,
): UntrustedContentEnvelope[] {
  return [
    ...(context.task ? [createPrivateEnvelope({
      originKind: "task_event",
      sourceId: `work-task:${context.task.id}`,
      request,
      purpose: "work_context",
      classification: "private",
      payload: {
        kind: "json",
        value: toJsonValue({
          id: context.task.id,
          title: context.task.title,
          objective: context.task.objective,
          status: context.task.status,
        }),
      },
      observedAt: context.task.updatedAt,
    })] : []),
    ...context.memories.map((memory) => createPrivateEnvelope({
      originKind: "durable_memory",
      sourceId: `durable-memory:${memory.id}`,
      request,
      purpose: "work_context",
      classification: memory.sensitivity,
      payload: {
        kind: "json",
        value: toJsonValue({
          kind: memory.kind,
          content: memory.content,
          expiresAt: memory.expiresAt,
          sourceProposalId: memory.sourceProposalId,
        }),
      },
      observedAt: memory.createdAt,
      reviewedAt: memory.createdAt,
      expiresAt: memory.expiresAt,
      freshnessStatus: memory.expiresAt === null ? "unknown" : "fresh",
    })),
    ...context.taskEvents.map((event) => createPrivateEnvelope({
      originKind: "task_event",
      sourceId: `task-event:${event.id}`,
      request,
      purpose: "work_context",
      classification: "private",
      payload: {
        kind: "json",
        value: toJsonValue({
          kind: event.kind,
          summary: event.summary,
          details: event.details,
          fromStatus: event.fromStatus,
          toStatus: event.toStatus,
          createdAt: event.createdAt,
        }),
      },
      observedAt: event.createdAt,
    })),
  ];
}

function createPrivateEnvelope(input: {
  readonly originKind: UntrustedContentOriginKind;
  readonly sourceId: string;
  readonly request: PrivateModelScope;
  readonly purpose: UntrustedContentPurpose;
  readonly classification: UntrustedContentClassification;
  readonly payload: { readonly kind: "text"; readonly text: string } |
    { readonly kind: "json"; readonly value: JsonValue };
  readonly observedAt: string;
  readonly reviewedAt?: string;
  readonly expiresAt?: string | null;
  readonly freshnessStatus?: "fresh" | "stale" | "unknown";
}): UntrustedContentEnvelope {
  return createUntrustedContentEnvelope({
    origin: { kind: input.originKind, sourceId: input.sourceId },
    scope: {
      actorId: input.request.actorId,
      workspaceId: input.request.workspaceId,
      channelKind: input.request.channelKind,
      channelId: input.request.channelId,
      threadId: input.request.threadId,
    },
    classification: input.classification,
    purpose: input.purpose,
    disclosureCeiling: "owner_only",
    review: input.reviewedAt
      ? { status: "approved", reviewedAt: input.reviewedAt }
      : { status: "unreviewed", reviewedAt: null },
    freshness: {
      observedAt: input.observedAt,
      expiresAt: input.expiresAt ?? null,
      status: input.freshnessStatus ?? "unknown",
    },
    revocation: { status: "active", revokedAt: null, reasonCode: null },
    payload: input.payload,
  });
}

function serializeCollection(envelopes: readonly UntrustedContentEnvelope[]): string {
  return `[${envelopes.map(serializeUntrustedContentEnvelope).join(",")}]`;
}

export function serializePrivateModelEnvelopes(
  envelopes: readonly UntrustedContentEnvelope[],
): string {
  return serializeCollection(envelopes);
}

function toJsonValue(input: unknown): JsonValue {
  return JSON.parse(JSON.stringify(input)) as JsonValue;
}
