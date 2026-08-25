import type { JoleneService } from "../application/jolene-service.js";
import { mapSlackEvent } from "./event-mapper.js";

export interface SlackPost {
  readonly channel: string;
  readonly threadTs: string;
  readonly text: string;
}

export type SlackPostMessage = (message: SlackPost) => Promise<void>;

export type SlackHandlingResult =
  | { readonly outcome: "ignored" }
  | { readonly outcome: "processing" }
  | { readonly outcome: "duplicate" }
  | { readonly outcome: "posted" };

export async function handleSlackEvent(
  service: JoleneService,
  envelope: unknown,
  botUserId: string | undefined,
  ownerUserId: string,
  postMessage: SlackPostMessage,
): Promise<SlackHandlingResult> {
  const mapped = mapSlackEvent(envelope, botUserId, ownerUserId);
  if (!mapped) {
    return { outcome: "ignored" };
  }

  const result = await service.chat(mapped.request);
  if (result.duplicate) {
    return { outcome: "duplicate" };
  }

  if (result.status === "processing" || !result.response) {
    return { outcome: "processing" };
  }

  await postMessage({
    channel: mapped.request.channelId,
    threadTs: mapped.replyThreadTs,
    text: result.response,
  });

  return { outcome: "posted" };
}
