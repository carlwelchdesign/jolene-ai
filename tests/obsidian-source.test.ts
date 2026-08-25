import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ObsidianKnowledgeSource } from "../src/knowledge/obsidian-source.js";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("ObsidianKnowledgeSource", () => {
  it("returns cited excerpts only from allowlisted folders", async () => {
    const root = await createVault();
    const source = new ObsidianKnowledgeSource({
      vaultRoot: root,
      allowlist: ["02 Projects"],
    });

    const results = await source.search(
      "Jolene personal chief of staff",
      searchContext(),
      5,
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      notePath: "02 Projects/Jolene AI.md",
      heading: "Primary role",
    });
    expect(results[0]?.excerpt).toContain("personal chief of staff");
  });

  it("returns nothing in a shared channel", async () => {
    const root = await createVault();
    const source = new ObsidianKnowledgeSource({
      vaultRoot: root,
      allowlist: ["02 Projects"],
    });

    await expect(
      source.search("Jolene", searchContext({ channelIsPrivate: false })),
    ).resolves.toEqual([]);
  });

  it("does not descend into dot directories", async () => {
    const root = await createVault();
    const source = new ObsidianKnowledgeSource({
      vaultRoot: root,
      allowlist: [".obsidian", "02 Projects"],
    });

    const results = await source.search(
      "secret graph settings",
      searchContext(),
      5,
    );

    expect(results).toEqual([]);
  });
});

async function createVault(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "jolene-vault-"));
  tempDirectories.push(root);
  await fs.mkdir(path.join(root, "02 Projects"), { recursive: true });
  await fs.mkdir(path.join(root, "Private"), { recursive: true });
  await fs.mkdir(path.join(root, ".obsidian"), { recursive: true });
  await fs.writeFile(
    path.join(root, "02 Projects", "Jolene AI.md"),
    "# Jolene AI\n\n## Primary role\n\nJolene is Carl's personal chief of staff.\n",
  );
  await fs.writeFile(
    path.join(root, "Private", "Secrets.md"),
    "# Secrets\n\nJolene must never return this private phrase.\n",
  );
  await fs.writeFile(
    path.join(root, ".obsidian", "graph.md"),
    "# Secret graph settings\n",
  );
  return root;
}

function searchContext(overrides = {}) {
  return {
    eventId: "test-event",
    actorId: "carl",
    workspaceId: "personal",
    channelIsPrivate: true,
    channelKind: "private_chat" as const,
    channelId: "local",
    threadId: "main",
    ...overrides,
  };
}
