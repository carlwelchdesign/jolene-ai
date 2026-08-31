import { describe, expect, it } from "vitest";

import {
  PUBLIC_CONVERSATION_PROMPTS,
  suggestPublicFollowUpQuestions,
} from "../src/public/public-conversation-prompts.js";
import { createPublicEvidenceRecord } from
  "./helpers/public-evidence-fixture.js";

describe("public conversation prompts", () => {
  it("maintains a large, unique, visitor-safe prompt bank", () => {
    const prompts = PUBLIC_CONVERSATION_PROMPTS.map(({ text }) => text);

    expect(prompts.length).toBeGreaterThanOrEqual(30);
    expect(new Set(prompts).size).toBe(prompts.length);
    expect(prompts.every((prompt) => prompt.length <= 240)).toBe(true);
    expect(prompts).toContain("Give me the strongest honest case for hiring Carl.");
  });

  it("uses question, evidence, and turn context to rotate relevant suggestions", () => {
    const aiEvidence = createPublicEvidenceRecord(1, {
      text: "Carl designed grounded AI retrieval with explicit authority limits.",
      title: "Jolene AI architecture",
      href: "/work/jolene-ai#evidence",
    });
    const question = "How does Carl handle AI systems?";
    const first = suggestPublicFollowUpQuestions({
      question,
      selectedEvidence: [aiEvidence],
      turnCount: 1,
    });
    const later = suggestPublicFollowUpQuestions({
      question,
      selectedEvidence: [aiEvidence],
      turnCount: 4,
    });

    expect(first).toHaveLength(3);
    expect(new Set(first).size).toBe(3);
    expect(first.join(" ")).toMatch(/AI|RAG|risk|security|privacy/iu);
    expect(later).not.toEqual(first);
    expect(first).not.toContain(question);
  });

  it("changes the next questions when the supporting work changes", () => {
    const ai = createPublicEvidenceRecord(1, {
      text: "Carl built an AI evaluation and release system.",
      title: "Jolene AI",
    });
    const leadership = createPublicEvidenceRecord(2, {
      text: "Carl mentored engineers and led a cross-functional product team.",
      title: "Technical leadership",
    });

    expect(suggestPublicFollowUpQuestions({
      question: "Tell me more.",
      selectedEvidence: [ai],
    })).not.toEqual(suggestPublicFollowUpQuestions({
      question: "Tell me more.",
      selectedEvidence: [leadership],
    }));
  });
});
