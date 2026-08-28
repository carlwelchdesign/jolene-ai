import { z } from "zod";

import type { ChatRequest } from "../application/jolene-service.js";

const slackEventEnvelopeSchema = z.object({
  event_id: z.string().trim().min(1),
  team_id: z.string().trim().min(1),
  event: z.object({
    type: z.enum(["app_mention", "message"]),
    user: z.string().trim().min(1).optional(),
    channel: z.string().trim().min(1),
    channel_type: z.string().optional(),
    text: z.string().optional(),
    ts: z.string().trim().min(1),
    thread_ts: z.string().trim().min(1).optional(),
    subtype: z.string().optional(),
    bot_id: z.string().optional(),
  }),
});

export interface MappedSlackEvent {
  readonly request: ChatRequest;
  readonly replyThreadTs: string;
}

export function mapSlackEvent(
  input: unknown,
  botUserId: string | undefined,
  ownerUserId: string,
  ownerTeamId: string,
): MappedSlackEvent | null {
  const parsed = slackEventEnvelopeSchema.safeParse(input);
  if (!parsed.success) {
    return null;
  }

  const { event } = parsed.data;
  if (parsed.data.team_id !== ownerTeamId) {
    return null;
  }
  if (event.subtype || event.bot_id || !event.user) {
    return null;
  }

  const isDirectMessage =
    event.type === "message" && event.channel_type === "im";
  if (isDirectMessage && event.user !== ownerUserId) {
    return null;
  }

  const channelKind =
    isDirectMessage
      ? "slack_dm"
      : event.type === "app_mention"
        ? "slack_shared"
        : null;

  if (!channelKind) {
    return null;
  }

  const message = cleanMessage(event.text ?? "", botUserId);
  if (!message) {
    return null;
  }

  const replyThreadTs = event.thread_ts ?? event.ts;
  return {
    request: {
      eventId: parsed.data.event_id,
      actorId: event.user,
      workspaceId: parsed.data.team_id,
      channelKind,
      channelId: event.channel,
      threadId: replyThreadTs,
      message,
    },
    replyThreadTs,
  };
}

function cleanMessage(text: string, botUserId: string | undefined): string {
  const withoutMention = botUserId
    ? text.replaceAll(`<@${botUserId}>`, " ")
    : text;

  return withoutMention.replaceAll(/\s+/g, " ").trim();
}
