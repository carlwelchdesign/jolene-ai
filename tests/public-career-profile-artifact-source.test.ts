import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import {
  PUBLIC_CAREER_CHAPTER_LIMITATION,
  publicCareerProfileDossierSchema,
} from "../src/domain/public-career-profile-dossier.js";
import { validatePublicArtifact } from "../src/public/public-artifact-source.js";
import { DeterministicPublicAnswerService } from
  "../src/public/public-answer-service.js";
import {
  mergePublicCareerProfile,
  PublicCareerProfileArtifactSource,
} from "../src/public/public-career-profile-artifact-source.js";
import { HybridPublicEvidenceRetriever } from
  "../src/public/public-hybrid-evidence-retriever.js";
import { createPublicEvidenceArtifact } from "./helpers/public-evidence-fixture.js";

const dossierPath = new URL(
  "../publications/career-profile-v1.json",
  import.meta.url,
);

const multiChapterLimitation =
  "Career scope: This is a representative public summary of documented delivery, not an exhaustive inventory of every project.";

async function careerProfileArtifact() {
  const dossier = publicCareerProfileDossierSchema.parse(
    JSON.parse(await readFile(dossierPath, "utf8")),
  );
  return {
    dossier,
    artifact: mergePublicCareerProfile(createPublicEvidenceArtifact(), dossier),
  };
}

describe("public career profile artifact source", () => {
  it("adds a reviewed five-chapter career arc and sixteen detailed roles idempotently", async () => {
    const base = createPublicEvidenceArtifact();
    const dossier = publicCareerProfileDossierSchema.parse(
      JSON.parse(await readFile(dossierPath, "utf8")),
    );
    const first = mergePublicCareerProfile(base, dossier);
    const second = mergePublicCareerProfile(first, dossier);
    const chapters = first.evidence.filter((record) =>
      record.claim.limitations.includes(PUBLIC_CAREER_CHAPTER_LIMITATION)
    );
    const profileEvidence = first.evidence.filter((record) =>
      record.citation.href === "/carl-welch-resume.pdf" ||
      record.citation.href === "/experience#career-foundations"
    );

    expect(chapters).toHaveLength(5);
    expect(profileEvidence).toHaveLength(21);
    expect(first.evidence).toHaveLength(base.evidence.length + 21);
    expect(second).toEqual(first);
    expect(validatePublicArtifact(first)).toEqual(first);
    await expect(new PublicCareerProfileArtifactSource({
      read: async () => base,
    }, dossier).read()).resolves.toEqual(first);
  });

  it.each([
    "What has Carl shipped?",
    "Has Carl only shipped his own projects?",
    "Which products and systems has Carl delivered?",
  ])("answers delivery questions across the whole career: %s", async (question) => {
    const { artifact } = await careerProfileArtifact();
    const result = new DeterministicPublicAnswerService().answer(artifact, {
      question,
    });

    expect(result.answer).toContain("more than 20 years");
    expect(result.answer).toContain("not only the projects he built for himself");
    expect(result.answer).toContain("University OnLine");
    expect(result.answer).toContain("Yubico");
    expect(result.answer).toContain("SapientNitro");
    expect(result.answer).toContain("General Dynamics");
    expect(result.answer).toContain("current independent work");
    expect(result.claims).toHaveLength(5);
    expect(result.citations).toHaveLength(5);
    expect(result.claims.every((claim) =>
      claim.limitations.includes(multiChapterLimitation)
    )).toBe(true);
    expect(result.limitations).toEqual([multiChapterLimitation]);
  });

  it("answers a career overview with one balanced chapter per era", async () => {
    const { artifact } = await careerProfileArtifact();
    const result = new DeterministicPublicAnswerService().answer(artifact, {
      question: "Walk me through Carl's career and work experience.",
    });

    expect(result.answer).toContain("one continuous line");
    expect(result.answer).toContain("U.S. Army");
    expect(result.answer).toContain("Grindr");
    expect(result.answer).toContain("current independent work");
    expect(result.claims).toHaveLength(5);
    expect(result.limitations).toEqual([multiChapterLimitation]);
  });

  it.each([
    ["What did Carl build at Yubico?", "YubiKey management"],
    ["What did Carl do at SapientNitro?", "high-traffic campaigns"],
    ["What did Carl deliver at AXON?", "Evidence.com workflows"],
    ["What did Carl build at GM Defense?", "spatial AR and VR"],
    ["What did Carl do at David Allen Company?", "online art direction"],
    ["What did Carl do at SAIC?", "information architecture"],
    ["What did Carl teach at Ignite Creative Learning?", "Scratch programming"],
    ["What was Carl's role in the U.S. Army?", "Fire Support Specialist"],
  ])("retrieves an exact employer-era record: %s", async (question, expected) => {
    const { artifact } = await careerProfileArtifact();
    const result = new DeterministicPublicAnswerService().answer(artifact, {
      question,
    });

    expect(result.answer).toContain(expected);
    expect(result.claims).toHaveLength(1);
    expect(result.citations).toHaveLength(1);
  });

  it("keeps hybrid retrieval on the deterministic career-wide delivery route", async () => {
    const { artifact } = await careerProfileArtifact();
    const embed = vi.fn(async () => [{ model: "test", vector: [1, 0] }]);
    const selected = await new HybridPublicEvidenceRetriever({ embed }).retrieve(
      artifact,
      { question: "What has Carl shipped?" },
    );

    expect(selected).toHaveLength(5);
    expect(selected.every((record) =>
      record.claim.limitations.includes(PUBLIC_CAREER_CHAPTER_LIMITATION)
    )).toBe(true);
    expect(embed).not.toHaveBeenCalled();
  });
});
