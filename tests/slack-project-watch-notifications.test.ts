import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createSlackOwnerNotificationPoster } from "../src/slack/project-watch-notifications.js";

describe("Slack Project Watch owner notifications", () => {
  it("opens only the configured owner DM and reuses that exact channel", async () => {
    const open = vi.fn(async () => ({ channel: { id: "D-OWNER" } }));
    const postMessage = vi.fn(async () => ({ ok: true }));
    const post = createSlackOwnerNotificationPoster(
      { conversations: { open }, chat: { postMessage } },
      "U-OWNER",
    );

    await post({ notificationId: "one", text: "First bounded alert" });
    await post({ notificationId: "two", text: "Second bounded alert" });

    expect(open).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledWith({ users: "U-OWNER" });
    expect(postMessage).toHaveBeenNthCalledWith(1, {
      channel: "D-OWNER",
      text: "First bounded alert",
    });
    expect(postMessage).toHaveBeenNthCalledWith(2, {
      channel: "D-OWNER",
      text: "Second bounded alert",
    });
  });

  it("fails closed when Slack does not return an owner DM channel", async () => {
    const post = createSlackOwnerNotificationPoster(
      {
        conversations: { open: async () => ({}) },
        chat: { postMessage: async () => undefined },
      },
      "U-OWNER",
    );
    await expect(post({ notificationId: "one", text: "Alert" })).rejects.toMatchObject({
      name: "slack_owner_dm_unavailable",
    });
  });

  it("reopens the exact owner DM after a failed post", async () => {
    const open = vi.fn(async () => ({ channel: { id: "D-OWNER" } }));
    let attempts = 0;
    const post = createSlackOwnerNotificationPoster(
      {
        conversations: { open },
        chat: {
          postMessage: async () => {
            attempts += 1;
            if (attempts === 1) throw new Error("stale channel");
          },
        },
      },
      "U-OWNER",
    );
    await expect(post({ notificationId: "one", text: "Alert" })).rejects.toThrow();
    await post({ notificationId: "one", text: "Alert" });
    expect(open).toHaveBeenCalledTimes(2);
    expect(open).toHaveBeenNthCalledWith(1, { users: "U-OWNER" });
    expect(open).toHaveBeenNthCalledWith(2, { users: "U-OWNER" });
  });

  it("stops polling and waits for an active drain before closing Slack", () => {
    const source = readFileSync(resolve(import.meta.dirname, "../src/slack.ts"), "utf8");
    const shutdown = source.slice(source.indexOf("if (stopping) return"));
    expect(shutdown.indexOf("clearInterval(notificationTimer)")).toBeLessThan(
      shutdown.indexOf("await notificationDrain"),
    );
    expect(shutdown.indexOf("await notificationDrain")).toBeLessThan(
      shutdown.indexOf("await slack.stop()"),
    );
    expect(shutdown.indexOf("await slack.stop()")).toBeLessThan(
      shutdown.indexOf("application.close()"),
    );
  });
});
