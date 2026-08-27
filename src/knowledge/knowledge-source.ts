import type { ChannelKind } from "../domain/conversation.js";

export interface KnowledgeSearchContext {
  readonly actorId: string;
  readonly workspaceId: string;
  readonly channelIsPrivate: boolean;
  readonly channelKind: ChannelKind;
  readonly channelId: string;
  readonly threadId: string;
  readonly eventId: string;
}

export type KnowledgeNamespace =
  | "career"
  | "projects"
  | "engineering"
  | "personal"
  | "sources"
  | "other";

export interface KnowledgeResult {
  readonly namespace: KnowledgeNamespace;
  readonly notePath: string;
  readonly heading: string;
  readonly excerpt: string;
  readonly modifiedAt: string;
  readonly score: number;
}

export interface KnowledgeSource {
  search(
    query: string,
    context: KnowledgeSearchContext,
    limit?: number,
  ): Promise<KnowledgeResult[]>;
}

export class UnavailableKnowledgeSource implements KnowledgeSource {
  async search(): Promise<KnowledgeResult[]> {
    return [];
  }
}
