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
  let ownerChannelRequest: Promise<string> | null = null;
  return async ({ text }) => {
    if (!ownerChannelId) {
      ownerChannelRequest ??= client.conversations.open({ users: ownerUserId })
        .then((opened) => {
          const channel = opened.channel?.id;
          if (!channel) {
            const error = new Error("Slack did not return the owner DM channel.");
            error.name = "slack_owner_dm_unavailable";
            throw error;
          }
          return channel;
        })
        .finally(() => { ownerChannelRequest = null; });
      ownerChannelId = await ownerChannelRequest;
    }
    try {
      await client.chat.postMessage({ channel: ownerChannelId, text });
    } catch (error) {
      ownerChannelId = null;
      throw error;
    }
  };
}
