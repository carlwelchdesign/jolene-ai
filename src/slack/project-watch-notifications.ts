import type { PostProjectWatchOwnerNotification } from "../application/watched-project-notification-service.js";

export interface SlackOwnerNotificationClient {
  readonly conversations: {
    open(input: { readonly users: string }): Promise<{
      readonly channel?: { readonly id?: string };
    }>;
  };
  readonly chat: {
    postMessage(input: {
      readonly channel: string;
      readonly text: string;
    }): Promise<unknown>;
  };
}

export function createSlackOwnerNotificationPoster(
  client: SlackOwnerNotificationClient,
  ownerUserId: string,
): PostProjectWatchOwnerNotification {
  let ownerChannelId: string | null = null;
  return async ({ text }) => {
    if (!ownerChannelId) {
      const opened = await client.conversations.open({ users: ownerUserId });
      ownerChannelId = opened.channel?.id ?? null;
      if (!ownerChannelId) {
        const error = new Error("Slack did not return the owner DM channel.");
        error.name = "slack_owner_dm_unavailable";
        throw error;
      }
    }
    try {
      await client.chat.postMessage({ channel: ownerChannelId, text });
    } catch (error) {
      ownerChannelId = null;
      throw error;
    }
  };
}
