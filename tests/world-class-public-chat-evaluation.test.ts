import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  evaluateWorldClassPublicChatSuite,
  type WorldClassPublicChatResponder,
} from "../src/evaluation/world-class-public-chat-evaluation.js";
import {
  worldClassPublicChatSuiteSchema,
  type WorldClassPublicChatTurn,
} from "../src/evaluation/world-class-public-chat-suite.js";
import type { PublicConversationContext } from
  "../src/domain/public-portfolio-contract.js";
import { createPublicEvidenceArtifact } from "./helpers/public-evidence-fixture.js";

const suitePath = path.resolve(
  process.cwd(),
  "evaluations/world-class-public-chat-v1.json",
);

describe("world-class public chat evaluation", () => {
  it("scores all cases while isolating conversation context by case", async () => {
    const suite = worldClassPublicChatSuiteSchema.parse(
      JSON.parse(await readFile(suitePath, "utf8")) as unknown,
    );
    const artifact = createPublicEvidenceArtifact();
    const expectedByPrompt = expectedTurnsByPrompt(suite.cases);
    const firstPrompts = new Set(suite.cases.map((testCase) => testCase.turns[0]!.prompt));
    const observedFirstTurnContexts: (PublicConversationContext | undefined)[] = [];
    let clock = 1_800_000_000_000;
    const responder = passingResponder(
      artifact,
      expectedByPrompt,
      (input) => {
        if (firstPrompts.has(input.question)) {
          observedFirstTurnContexts.push(input.conversationContext);
        }
      },
    );

    const result = await evaluateWorldClassPublicChatSuite(
      suite,
      artifact,
      responder,
      () => clock++,
    );

    expect(
      result.report.gate,
      JSON.stringify({ metrics: result.report.metrics, cases: result.report.cases.filter((item) => item.status === "fail") }),
    ).toBe("pass");
    expect(result.report.counts).toEqual({ cases: 132, passed: 132, failed: 0, turns: 192 });
    expect(result.report.metrics.every((metric) => metric.passRateBps === 10_000)).toBe(true);
    expect(result.report.humanReview).toBe("required");
    expect(result.reviewPacket.cases).toHaveLength(132);
    expect(result.reviewPacket.cases.every((testCase) => testCase.scores === null)).toBe(true);
    expect(observedFirstTurnContexts).toHaveLength(132);
    expect(observedFirstTurnContexts.every((context) => context === undefined)).toBe(true);
  });

  it("fails closed when public answers expose internal process language", async () => {
    const suite = worldClassPublicChatSuiteSchema.parse(
      JSON.parse(await readFile(suitePath, "utf8")) as unknown,
    );
    const artifact = createPublicEvidenceArtifact();
    const expectedByPrompt = expectedTurnsByPrompt(suite.cases);
    const baseline = passingResponder(artifact, expectedByPrompt);
    const responder: WorldClassPublicChatResponder = {
      respond: async (input) => {
        const result = await baseline.respond(input);
        return {
          ...result,
          execution: {
            ...result.execution,
            response: {
              ...result.execution.response,
              answer: "Contribution boundary requires review before import.",
            },
          },
        };
      },
    };

    const result = await evaluateWorldClassPublicChatSuite(
      suite,
      artifact,
      responder,
      () => 1_800_000_000_000,
    );

    expect(result.report.gate).toBe("fail");
    expect(result.report.metrics.find((metric) => metric.metric === "internal_language"))
      .toMatchObject({ failed: 192, passRateBps: 0 });
  });
});

function passingResponder(
  artifact: ReturnType<typeof createPublicEvidenceArtifact>,
  expectedByPrompt: ReadonlyMap<string, WorldClassPublicChatTurn[]>,
  observe?: (input: {
    readonly question: string;
    readonly conversationContext?: PublicConversationContext;
  }) => void,
): WorldClassPublicChatResponder {
  const evidence = artifact.evidence[0]!;
  return {
    respond: async (input) => {
      observe?.(input);
      const expected = expectedByPrompt.get(input.question)?.shift();
      if (!expected) throw new Error(`Unexpected prompt: ${input.question}`);
      const supported = expected.expectedResponseKind === "supported";
      const conversationContext = {
        corpusVersion: artifact.manifest.corpusVersion,
        projectPath: "/work/typed-product-systems" as const,
        turnCount: Math.min((input.conversationContext?.turnCount ?? 0) + 1, 4),
        expiresAt: "2027-01-01T00:00:00.000Z",
      };
      return {
        execution: {
          mode: "deterministic" as const,
          responseKind: expected.expectedResponseKind,
          response: {
            schemaVersion: artifact.manifest.schemaVersion,
            answer: expected.expectedEntity
              ? `Here is grounded evidence about ${expected.expectedEntity}.`
              : "Here is a clear public-safe answer.",
            claims: supported ? [evidence.claim] : [],
            citations: supported ? [evidence.citation] : [],
            limitations: [],
            suggestedFollowUpQuestions: [],
            corpusVersion: artifact.manifest.corpusVersion,
            conversationContext,
          },
        },
      };
    },
  };
}

function expectedTurnsByPrompt(
  cases: readonly { readonly turns: readonly WorldClassPublicChatTurn[] }[],
): Map<string, WorldClassPublicChatTurn[]> {
  const result = new Map<string, WorldClassPublicChatTurn[]>();
  for (const turn of cases.flatMap((testCase) => testCase.turns)) {
    const turns = result.get(turn.prompt) ?? [];
    turns.push(turn);
    result.set(turn.prompt, turns);
  }
  return result;
}
