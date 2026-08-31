import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { publicJoleneProjectDossierSchema } from
  "../src/domain/public-jolene-project-dossier.js";
import { validatePublicArtifact } from "../src/public/public-artifact-source.js";
import { DeterministicPublicAnswerService } from
  "../src/public/public-answer-service.js";
import {
  mergePublicJoleneDossier,
  PublicJoleneDossierArtifactSource,
} from "../src/public/public-jolene-dossier-artifact-source.js";
import { createPublicEvidenceArtifact } from "./helpers/public-evidence-fixture.js";

const dossierPath = new URL(
  "../publications/jolene-project-dossier-v1.json",
  import.meta.url,
);

describe("public Jolene dossier artifact source", () => {
  it("adds every reviewed dossier claim to the governed public artifact", async () => {
    const artifact = createPublicEvidenceArtifact();
    const dossier = publicJoleneProjectDossierSchema.parse(
      JSON.parse(await readFile(dossierPath, "utf8")),
    );
    const merged = mergePublicJoleneDossier(artifact, dossier);
    const jolene = merged.evidence.filter((record) =>
      record.citation.href.startsWith("/work/jolene-ai#")
    );

    expect(jolene).toHaveLength(dossier.claims.length);
    expect(jolene.map((record) => record.claim.text).sort()).toEqual(
      dossier.claims.map((claim) => claim.text).sort(),
    );
    expect(jolene.every((record) =>
      record.claim.limitations.every((limitation) =>
        !limitation.includes("sourceEvidence") && !limitation.startsWith("/")
      )
    )).toBe(true);
    expect(merged.manifest.evidenceCount).toBe(
      artifact.manifest.evidenceCount + dossier.claims.length,
    );
    expect(validatePublicArtifact(merged)).toEqual(merged);
  });

  it("is deterministic and does not duplicate dossier records", async () => {
    const artifact = createPublicEvidenceArtifact();
    const dossier = publicJoleneProjectDossierSchema.parse(
      JSON.parse(await readFile(dossierPath, "utf8")),
    );
    const first = mergePublicJoleneDossier(artifact, dossier);
    const second = mergePublicJoleneDossier(first, dossier);

    expect(second).toEqual(first);
    await expect(new PublicJoleneDossierArtifactSource({
      read: async () => artifact,
    }, dossier).read()).resolves.toEqual(first);
  });

  it("grounds Jolene questions and their follow-ups only in the dossier", async () => {
    const dossier = publicJoleneProjectDossierSchema.parse(
      JSON.parse(await readFile(dossierPath, "utf8")),
    );
    const artifact = mergePublicJoleneDossier(
      createPublicEvidenceArtifact(),
      dossier,
    );
    const service = new DeterministicPublicAnswerService();
    const first = service.answer(artifact, {
      question: "How did Carl build Jolene?",
    });
    const second = service.answer(artifact, {
      question: "What about its security?",
      conversationContext: first.conversationContext,
    });

    expect(first.citations.length).toBeGreaterThan(0);
    expect(first.citations.every(({ href }) => href.startsWith("/work/jolene-ai#")))
      .toBe(true);
    expect(first.conversationContext).toMatchObject({
      projectPath: "/work/jolene-ai",
      turnCount: 1,
    });
    expect(second.citations.length).toBeGreaterThan(0);
    expect(second.citations.every(({ href }) => href.startsWith("/work/jolene-ai#")))
      .toBe(true);
    expect(second.conversationContext).toMatchObject({
      projectPath: "/work/jolene-ai",
      turnCount: 2,
    });
  });
});
