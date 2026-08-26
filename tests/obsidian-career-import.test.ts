import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ObsidianCareerImporter } from "../src/application/obsidian-career-importer.js";
import { parseObsidianCareerNote } from "../src/knowledge/obsidian-markdown.js";
import { ObsidianVaultReader } from "../src/knowledge/obsidian-vault.js";
import { SqliteCareerEvidenceStore } from "../src/persistence/sqlite-career-evidence-store.js";

const tempDirectories: string[] = [];
const scope = { actorId: "carl", workspaceId: "professional" };

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("parseObsidianCareerNote", () => {
  it("parses frontmatter, headings, links, dates, and body without losing its first character", () => {
    const parsed = parseObsidianCareerNote(
      "01 Career & Job Search/Evidence.md",
      [
        "---",
        "tags:",
        "  - career",
        "  - evidence",
        "aliases: [Career Proof, Work Proof]",
        "updated: 2026-08-25",
        "---",
        "# Career Evidence",
        "",
        "First character remains intact and links to [[Job Search OS]].",
        "",
        "## Public proof",
        "",
        "See [portfolio](https://example.com/work) and #leadership.",
      ].join("\n"),
    );

    expect(parsed).toMatchObject({
      title: "Career Evidence",
      tags: ["career", "evidence", "leadership"],
      aliases: ["Career Proof", "Work Proof"],
      wikiLinks: ["Job Search OS"],
      markdownLinks: ["https://example.com/work"],
      documentDate: "2026-08-25",
      importEnabled: true,
    });
    expect(parsed.sections).toHaveLength(2);
    expect(parsed.sections[0]?.content).toMatch(/^First character/);
    expect(parsed.sections[1]).toMatchObject({
      heading: "Public proof",
      headingPath: ["Career Evidence", "Public proof"],
    });
  });

  it("honors an explicit import opt-out", () => {
    expect(
      parseObsidianCareerNote(
        "01 Career & Job Search/Private.md",
        "---\njolene_career_import: false\n---\n# Private\n\nDo not import.",
      ).importEnabled,
    ).toBe(false);
  });
});

describe("ObsidianCareerImporter", () => {
  it("imports only allowlisted notes as private review-required evidence", async () => {
    const root = await createVault();
    const store = new SqliteCareerEvidenceStore(":memory:");
    try {
      const report = await importer(store, root).import();
      expect(report).toEqual({
        documentsDiscovered: 1,
        documentsImported: 1,
        documentsSkipped: 0,
        missingSourceCount: 0,
        activeClaimCount: 2,
        supersededClaimCount: 0,
        activeRelationshipCount: 3,
        revokedRelationshipCount: 0,
        importedPublicClaimCount: 0,
      });
      const [source] = store.listSources(scope);
      expect(source).toMatchObject({
        sourceType: "career_note",
        reviewState: "needs_review",
        provenanceUri: null,
        metadata: {
          relativePath: "01 Career & Job Search/Evidence.md",
          tags: ["career", "evidence"],
          wikiLinks: ["Job Search OS"],
          documentDate: "2026-08-25",
        },
      });
      expect(store.listClaims(scope).every((claim) =>
        claim.visibility === "private" && claim.reviewState === "needs_review"
      )).toBe(true);
    } finally {
      store.close();
    }
  });

  it("is idempotent and supersedes sections removed from the current note", async () => {
    const root = await createVault();
    const store = new SqliteCareerEvidenceStore(":memory:");
    try {
      const run = importer(store, root);
      const first = await run.import();
      expect(await run.import()).toEqual(first);

      await fs.writeFile(
        path.join(root, "01 Career & Job Search", "Evidence.md"),
        "---\ntags: [career]\nupdated: 2026-08-25\n---\n# Career Evidence\n\nCurrent evidence remains under review.\n",
      );
      const changed = await run.import();
      expect(changed.activeClaimCount).toBe(1);
      expect(changed.supersededClaimCount).toBe(2);
      expect(changed.activeRelationshipCount).toBe(1);
      expect(changed.revokedRelationshipCount).toBe(2);
    } finally {
      store.close();
    }
  });

  it("marks deleted or opted-out notes missing and safely restores reappearing notes", async () => {
    const root = await createVault();
    const notePath = path.join(root, "01 Career & Job Search", "Evidence.md");
    const store = new SqliteCareerEvidenceStore(":memory:");
    try {
      const run = importer(store, root);
      await run.import();
      const original = await fs.readFile(notePath, "utf8");
      await fs.rm(notePath);
      expect((await run.import()).missingSourceCount).toBe(1);
      expect(store.listSources(scope)[0]?.state).toBe("missing");

      await fs.writeFile(notePath, original);
      expect((await run.import()).missingSourceCount).toBe(0);
      expect(store.listSources(scope)[0]).toMatchObject({
        state: "active",
        reviewState: "needs_review",
      });

      await fs.writeFile(
        notePath,
        "---\njolene_career_import: false\n---\n# Evidence\n\nOpted out.",
      );
      const optedOut = await run.import();
      expect(optedOut.documentsSkipped).toBe(1);
      expect(optedOut.missingSourceCount).toBe(1);
    } finally {
      store.close();
    }
  });

  it("rejects allowlist traversal outside the vault", async () => {
    const root = await createVault();
    expect(() => new ObsidianVaultReader({
      vaultRoot: root,
      allowlist: ["../Private"],
    })).toThrow("must stay inside the vault");
  });
});

function importer(store: SqliteCareerEvidenceStore, root: string) {
  return new ObsidianCareerImporter({
    store,
    vaultRoot: root,
    allowlist: ["01 Career & Job Search"],
    ...scope,
  });
}

async function createVault(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "jolene-career-vault-"));
  tempDirectories.push(root);
  await fs.mkdir(path.join(root, "01 Career & Job Search"), { recursive: true });
  await fs.mkdir(path.join(root, "Private"), { recursive: true });
  await fs.mkdir(path.join(root, ".obsidian"), { recursive: true });
  await fs.writeFile(
    path.join(root, "01 Career & Job Search", "Evidence.md"),
    [
      "---",
      "tags: [career, evidence]",
      "updated: 2026-08-25",
      "---",
      "# Career Evidence",
      "",
      "Current evidence links to [[Job Search OS]].",
      "",
      "## Public proof",
      "",
      "See [portfolio](https://example.com/work).",
    ].join("\n"),
  );
  await fs.writeFile(
    path.join(root, "Private", "Secrets.md"),
    "# Secrets\n\nNever import this note.",
  );
  await fs.writeFile(
    path.join(root, ".obsidian", "Hidden.md"),
    "# Hidden\n\nNever import settings.",
  );
  return root;
}
