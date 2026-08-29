import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  publicJoleneDossierTopicSchema,
  publicJoleneProjectDossierSchema,
} from "../src/domain/public-jolene-project-dossier.js";

const dossierPath = new URL(
  "../publications/jolene-project-dossier-v1.json",
  import.meta.url,
);

describe("public Jolene project dossier", () => {
  it("publishes one public-safe, citable claim for every required topic", async () => {
    const dossier = publicJoleneProjectDossierSchema.parse(
      JSON.parse(await readFile(dossierPath, "utf8")),
    );

    expect(dossier.claims.map((claim) => claim.topic).sort()).toEqual(
      [...publicJoleneDossierTopicSchema.options].sort(),
    );
    expect(dossier.claims.every((claim) =>
      claim.citation.href.startsWith("/work/jolene-ai#")
    )).toBe(true);
  });

  it("rejects missing topics, private disclosure, and non-case-study citations", async () => {
    const dossier = JSON.parse(await readFile(dossierPath, "utf8"));
    expect(publicJoleneProjectDossierSchema.safeParse({
      ...dossier,
      claims: dossier.claims.slice(1),
    }).success).toBe(false);
    expect(publicJoleneProjectDossierSchema.safeParse({
      ...dossier,
      claims: dossier.claims.map((claim: Record<string, unknown>, index: number) =>
        index === 0 ? { ...claim, text: "/Users/carl/private-note.md" } : claim
      ),
    }).success).toBe(false);
    expect(publicJoleneProjectDossierSchema.safeParse({
      ...dossier,
      claims: dossier.claims.map((claim: Record<string, unknown>, index: number) =>
        index === 0
          ? { ...claim, citation: { title: "Wrong", href: "/work/other#architecture" } }
          : claim
      ),
    }).success).toBe(false);
  });
});
