import { z } from "zod";

export const channelKindSchema = z.enum([
  "cli",
  "private_chat",
  "slack_dm",
  "slack_private",
  "slack_shared",
]);

export type ChannelKind = z.infer<typeof channelKindSchema>;

export const conversationAddressSchema = z.object({
  actorId: z.string().trim().min(1).max(120),
  workspaceId: z.string().trim().min(1).max(120),
  channelKind: channelKindSchema,
  channelId: z.string().trim().min(1).max(240),
  threadId: z.string().trim().min(1).max(240),
});

export type ConversationAddress = z.infer<typeof conversationAddressSchema>;

export type TurnRole = "user" | "assistant";

export interface ConversationTurn {
  readonly id: string;
  readonly role: TurnRole;
  readonly content: string;
  readonly createdAt: string;
}

export interface CompletedExchange {
  readonly userMessage: string;
  readonly assistantMessage: string;
}

export type EventClaim =
  | { readonly kind: "claimed"; readonly eventKey: string }
  | {
      readonly kind: "duplicate";
      readonly status: "processing" | "completed";
      readonly response: string | null;
    };

export interface ConversationStore {
  claimEvent(
    address: ConversationAddress,
    eventId: string,
    message: string,
  ): EventClaim;
  completeEvent(eventKey: string, exchange: CompletedExchange): void;
  failEvent(eventKey: string, errorCode: string): void;
  recentTurns(address: ConversationAddress, limit: number): ConversationTurn[];
  close(): void;
}
