import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import { publicResumeProjectDossierSchema } from
  "../src/domain/public-resume-project-dossier.js";
import { validatePublicArtifact } from "../src/public/public-artifact-source.js";
import { DeterministicPublicAnswerService } from
  "../src/public/public-answer-service.js";
import { HybridPublicEvidenceRetriever } from
  "../src/public/public-hybrid-evidence-retriever.js";
import {
  mergePublicResumeProjects,
  PublicResumeProjectArtifactSource,
} from "../src/public/public-resume-project-artifact-source.js";
import { createPublicEvidenceArtifact } from "./helpers/public-evidence-fixture.js";

const dossierPath = new URL(
  "../publications/resume-projects-v1.json",
  import.meta.url,
);

async function resumeArtifact() {
  const dossier = publicResumeProjectDossierSchema.parse(
    JSON.parse(await readFile(dossierPath, "utf8")),
  );
  return {
    dossier,
    artifact: mergePublicResumeProjects(createPublicEvidenceArtifact(), dossier),
  };
}

describe("public resume project artifact source", () => {
  it("adds five resume-cited project delivery records idempotently", async () => {
    const base = createPublicEvidenceArtifact();
    const dossier = publicResumeProjectDossierSchema.parse(
      JSON.parse(await readFile(dossierPath, "utf8")),
    );
    const first = mergePublicResumeProjects(base, dossier);
    const second = mergePublicResumeProjects(first, dossier);
    const resumeEvidence = first.evidence.filter((record) =>
      record.citation.sourceType === "resume"
    );

    expect(resumeEvidence).toHaveLength(5);
    expect(resumeEvidence.every((record) =>
      record.citation.href === "/carl-welch-resume.pdf"
    )).toBe(true);
    expect(second).toEqual(first);
    expect(validatePublicArtifact(first)).toEqual(first);
    await expect(new PublicResumeProjectArtifactSource({
      read: async () => base,
    }, dossier).read()).resolves.toEqual(first);
  });

  it.each([
    "What has Carl shipped?",
    "Which products has Carl launched?",
    "Show me the software Carl delivered.",
  ])("answers shipped-work language with all and only resume projects: %s", async (
    question,
  ) => {
    const { artifact } = await resumeArtifact();
    const result = new DeterministicPublicAnswerService().answer(artifact, {
      question,
    });

    expect(result.answer).toContain("Carl shipped every project on his résumé");
    for (const name of [
      "ProgressionLab",
      "Job Search OS",
      "Flight Tracker AI",
      "Supraconscious Avatar AI",
      "Argent Matchmaking",
    ]) {
      expect(result.answer).toContain(name);
    }
    expect(result.claims).toHaveLength(5);
    expect(result.citations).toHaveLength(5);
    expect(result.citations.every((citation) =>
      citation.sourceType === "resume" &&
      citation.href === "/carl-welch-resume.pdf"
    )).toBe(true);
  });

  it("does not let semantic retrieval add unrelated deployed projects", async () => {
    const { artifact } = await resumeArtifact();
    const embed = vi.fn(async () => [{ model: "test", vector: [1, 0] }]);
    const result = await new HybridPublicEvidenceRetriever({ embed }).retrieve(
      artifact,
      { question: "What has Carl shipped?" },
    );

    expect(result).toHaveLength(5);
    expect(result.every((record) => record.citation.sourceType === "resume"))
      .toBe(true);
    expect(embed).not.toHaveBeenCalled();
  });
});
