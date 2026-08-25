import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { DeliveryAddress } from "../src/domain/delivery.js";
import { SqliteConversationStore } from "../src/persistence/sqlite-conversation-store.js";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

const delivery: DeliveryAddress = {
  platform: "slack",
  workspaceId: "T123",
  channelId: "D123",
  threadId: "1710000000.001",
  sourceEventId: "Ev123",
};

describe("SQLite delivery persistence", () => {
  it("remembers a completed delivery after restart", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "jolene-delivery-"),
    );
    tempDirectories.push(directory);
    const databasePath = path.join(directory, "jolene.sqlite");

    const firstStore = new SqliteConversationStore(databasePath);
    const claim = firstStore.claimDelivery(delivery);
    if (claim.kind !== "claimed") throw new Error("Expected claim");
    firstStore.completeDelivery(claim.deliveryKey);
    firstStore.close();

    const restartedStore = new SqliteConversationStore(databasePath);
    try {
      expect(restartedStore.claimDelivery(delivery)).toEqual({
        kind: "duplicate",
        status: "completed",
      });
    } finally {
      restartedStore.close();
    }
  });
});
