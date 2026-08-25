import { z } from "zod";

import type { JoleneAgentRunner } from "../agent/agent-runner.js";
import {
  channelKindSchema,
  conversationAddressSchema,
  type ConversationAddress,
  type ConversationStore,
} from "../domain/conversation.js";
import { isPrivateChannel } from "../domain/policy.js";
import type {
  AuthorizedWorkContext,
  WorkContextReader,
} from "../domain/work-context.js";

export const chatRequestSchema = conversationAddressSchema.extend({
  eventId: z.string().trim().min(1).max(240),
  taskId: z.string().uuid().optional(),
  includeSensitiveMemory: z.boolean().optional(),
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
  readonly workContext: WorkContextReader;
  readonly maxHistoryTurns: number;
  readonly maxMemoryItems: number;
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

    try {
      const history = this.options.store.recentTurns(
        address,
        this.options.maxHistoryTurns,
      );
      const workContext = isPrivateChannel(request.channelKind)
        ? this.options.workContext.loadAuthorizedContext({
            actorId: request.actorId,
            workspaceId: request.workspaceId,
            taskId: request.taskId,
            memoryLimit: this.options.maxMemoryItems,
            includeSensitiveMemory: request.includeSensitiveMemory ?? false,
            query: request.message,
          })
        : EMPTY_WORK_CONTEXT;
      const response = await this.options.runner.respond({
        actorId: request.actorId,
        channelKind: request.channelKind,
        message: request.message,
        history,
        workContext,
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

const EMPTY_WORK_CONTEXT: AuthorizedWorkContext = {
  task: null,
  memories: [],
};

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
