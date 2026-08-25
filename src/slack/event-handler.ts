import type { JoleneService } from "../application/jolene-service.js";
import type { DeliveryStore } from "../domain/delivery.js";
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
  deliveries: DeliveryStore,
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
  if (result.status === "processing" || !result.response) {
    return { outcome: "processing" };
  }

  const delivery = deliveries.claimDelivery({
    platform: "slack",
    workspaceId: mapped.request.workspaceId,
    channelId: mapped.request.channelId,
    threadId: mapped.replyThreadTs,
    sourceEventId: mapped.request.eventId,
  });

  if (delivery.kind === "duplicate") {
    return {
      outcome: delivery.status === "completed" ? "duplicate" : "processing",
    };
  }

  try {
    await postMessage({
      channel: mapped.request.channelId,
      threadTs: mapped.replyThreadTs,
      text: result.response,
    });
    deliveries.completeDelivery(delivery.deliveryKey);
  } catch (error) {
    deliveries.failDelivery(delivery.deliveryKey, classifyDeliveryError(error));
    throw error;
  }

  return { outcome: "posted" };
}

function classifyDeliveryError(error: unknown): string {
  if (error instanceof Error && error.name) {
    return error.name.toLowerCase().replaceAll(/[^a-z0-9_-]/g, "_");
  }

  return "unknown_error";
}
