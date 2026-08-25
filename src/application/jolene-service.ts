import { z } from "zod";

import type { JoleneAgentRunner } from "../agent/agent-runner.js";
import {
  channelKindSchema,
  conversationAddressSchema,
  type ConversationAddress,
  type ConversationStore,
} from "../domain/conversation.js";

export const chatRequestSchema = conversationAddressSchema.extend({
  eventId: z.string().trim().min(1).max(240),
  message: z.string().trim().min(1).max(40_000),
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;

export interface ChatResult {
  readonly status: "completed" | "processing";
  readonly duplicate: boolean;
  readonly response: string | null;
}

export interface JoleneServiceOptions {
  readonly store: ConversationStore;
  readonly runner: JoleneAgentRunner;
  readonly maxHistoryTurns: number;
}

export class JoleneService {
  constructor(private readonly options: JoleneServiceOptions) {}

  async chat(input: ChatRequest): Promise<ChatResult> {
    const request = chatRequestSchema.parse(input);
    const address = toAddress(request);
    const claim = this.options.store.claimEvent(
      address,
      request.eventId,
      request.message,
    );

    if (claim.kind === "duplicate") {
      return {
        status: claim.status,
        duplicate: true,
        response: claim.response,
      };
    }

    const history = this.options.store.recentTurns(
      address,
      this.options.maxHistoryTurns,
    );

    try {
      const response = await this.options.runner.respond({
        actorId: request.actorId,
        channelKind: request.channelKind,
        message: request.message,
        history,
      });

      this.options.store.completeEvent(claim.eventKey, {
        userMessage: request.message,
        assistantMessage: response,
      });

      return { status: "completed", duplicate: false, response };
    } catch (error) {
      this.options.store.failEvent(claim.eventKey, classifyError(error));
      throw error;
    }
  }
}

function toAddress(request: ChatRequest): ConversationAddress {
  return {
    actorId: request.actorId,
    workspaceId: request.workspaceId,
    channelKind: channelKindSchema.parse(request.channelKind),
    channelId: request.channelId,
    threadId: request.threadId,
  };
}

function classifyError(error: unknown): string {
  if (error instanceof Error && error.name) {
    return error.name.toLowerCase().replaceAll(/[^a-z0-9_-]/g, "_");
  }

  return "unknown_error";
}
