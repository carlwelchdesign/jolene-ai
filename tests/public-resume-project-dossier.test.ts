import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { publicResumeProjectDossierSchema } from
  "../src/domain/public-resume-project-dossier.js";

const dossierPath = new URL(
  "../publications/resume-projects-v1.json",
  import.meta.url,
);

describe("public resume project dossier", () => {
  it("publishes the five shipped projects named on Carl's public resume", async () => {
    const dossier = publicResumeProjectDossierSchema.parse(
      JSON.parse(await readFile(dossierPath, "utf8")),
    );

    expect(dossier.projects.map(({ name }) => name)).toEqual([
      "ProgressionLab",
      "Job Search OS",
      "Flight Tracker AI",
      "Supraconscious Avatar AI",
      "Argent Matchmaking",
    ]);
    expect(dossier.citationHref).toBe("/carl-welch-resume.pdf");
  });

  it("rejects duplicate projects and private disclosure", async () => {
    const dossier = JSON.parse(await readFile(dossierPath, "utf8"));
    expect(publicResumeProjectDossierSchema.safeParse({
      ...dossier,
      projects: [...dossier.projects, dossier.projects[0]],
    }).success).toBe(false);
    expect(publicResumeProjectDossierSchema.safeParse({
      ...dossier,
      projects: dossier.projects.map(
        (project: Record<string, unknown>, index: number) =>
          index === 0 ? { ...project, claim: "/Users/carl/private.md" } : project,
      ),
    }).success).toBe(false);
  });
});
