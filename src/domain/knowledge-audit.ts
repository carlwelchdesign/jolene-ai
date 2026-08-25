import type { ChannelKind } from "./conversation.js";

export type KnowledgeAccessStatus = "completed" | "failed";

export interface KnowledgeCitationRecord {
  readonly notePath: string;
  readonly heading: string;
  readonly modifiedAt: string;
  readonly score: number;
}

export interface KnowledgeAccessRecord {
  readonly id: string;
  readonly eventId: string;
  readonly actorId: string;
  readonly workspaceId: string;
  readonly channelKind: ChannelKind;
  readonly channelId: string;
  readonly threadId: string;
  readonly queryFingerprint: string;
  readonly status: KnowledgeAccessStatus;
  readonly resultCount: number;
  readonly errorCode: string | null;
  readonly citations: readonly KnowledgeCitationRecord[];
  readonly createdAt: string;
}

export interface RecordKnowledgeAccessInput {
  readonly eventId: string;
  readonly actorId: string;
  readonly workspaceId: string;
  readonly channelKind: ChannelKind;
  readonly channelId: string;
  readonly threadId: string;
  readonly queryFingerprint: string;
  readonly status: KnowledgeAccessStatus;
  readonly resultCount: number;
  readonly errorCode: string | null;
  readonly citations: readonly KnowledgeCitationRecord[];
}

export interface ListKnowledgeAccessInput {
  readonly actorId: string;
  readonly workspaceId: string;
  readonly eventId?: string;
  readonly limit: number;
}

export interface KnowledgeAccessStore {
  recordAccess(input: RecordKnowledgeAccessInput): KnowledgeAccessRecord;
  listAccesses(input: ListKnowledgeAccessInput): readonly KnowledgeAccessRecord[];
  close(): void;
}
