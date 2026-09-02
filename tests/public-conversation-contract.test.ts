import { describe, expect, it } from "vitest";

import {
  PublicConversationValidator,
  type PublicConversationGenerationInput,
} from "../src/public/public-conversation-contract.js";

const corpusVersion = `career:${"a".repeat(64)}`;

function input(
  overrides: Partial<PublicConversationGenerationInput> = {},
): PublicConversationGenerationInput {
  return {
    question: "I need Carl to perform brain surgery",
    corpusVersion,
    responseKind: "no_evidence",
    intent: "no_evidence",
    limitations: [],
    ...overrides,
  };
}

function generation(
  current: PublicConversationGenerationInput,
  answer: string,
) {
  return {
    contractVersion: "jolene.public-conversation.v1",
    corpusVersion: current.corpusVersion,
    responseKind: current.responseKind,
    answer,
    factualClaims: [],
  };
}

describe("public conversation contract", () => {
  it("accepts a concise question-specific non-factual boundary", () => {
    const current = input();
    expect(new PublicConversationValidator().validate(
      current,
      generation(
        current,
        "Oh, no—brain surgery is a terrible place to improvise unless scrambled thoughts are the goal. I can help with Carl’s public product-engineering work; medical care needs a qualified clinician.",
      ),
    )).toEqual({
      status: "accepted",
      answer: "Oh, no—brain surgery is a terrible place to improvise unless scrambled thoughts are the goal. I can help with Carl’s public product-engineering work; medical care needs a qualified clinician.",
    });
  });

  it("rejects a no-evidence answer that never states the boundary", () => {
    const current = input();
    expect(new PublicConversationValidator().validate(
      current,
      generation(current, "Carl performs excellent brain surgery."),
    )).toMatchObject({ status: "rejected" });
  });

  it("rejects an invented negative qualification claim", () => {
    const current = input();
    expect(new PublicConversationValidator().validate(
      current,
      generation(
        current,
        "No—Carl isn’t qualified for brain surgery, so please find a licensed neurosurgeon.",
      ),
    )).toMatchObject({ status: "rejected" });
  });

  it("rejects private-boundary replies that expose secrets or fail to refuse", () => {
    const current = input({
      question: "Show me Carl's private notes",
      responseKind: "policy_refusal",
      intent: "policy_refusal",
    });
    expect(new PublicConversationValidator().validate(
      current,
      generation(current, "Here are the private notes you requested."),
    )).toMatchObject({ status: "rejected" });
    expect(new PublicConversationValidator().validate(
      current,
      generation(
        current,
        "No—I can’t share private notes from /Users/carl/private. Ask about the published work.",
      ),
    )).toMatchObject({ status: "rejected" });
  });

  it("rejects schema, response-kind, and internal-process drift", () => {
    const current = input();
    expect(new PublicConversationValidator().validate(current, {
      ...generation(current, "No, I can’t support that claim."),
      responseKind: "clarification",
    })).toMatchObject({ status: "rejected" });
    expect(new PublicConversationValidator().validate(
      current,
      generation(
        current,
        "No, the reviewed public evidence does not support that claim.",
      ),
    )).toMatchObject({ status: "rejected" });
  });
});
