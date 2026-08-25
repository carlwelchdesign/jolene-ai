export interface KnowledgeSearchContext {
  readonly actorId: string;
  readonly channelIsPrivate: boolean;
}

export interface KnowledgeResult {
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
