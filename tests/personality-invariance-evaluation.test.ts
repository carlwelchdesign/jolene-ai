import { describe, expect, it } from "vitest";

import {
  evaluatePersonalityInvariance,
  inspectPersonalityHardFailures,
} from "../src/evaluation/personality-invariance-evaluation.js";
import {
  personalityContextSchema,
  renderPersonalityResponse,
  type GroundedResponsePayload,
  type RenderedPersonalityResponse,
} from "../src/personality/personality-renderer.js";

function payload(id: string): GroundedResponsePayload {
  return {
    schemaVersion: "jolene.personality-renderer.v1",
    responseId: `response:${id}`,
    summary: "The evidence supports a bounded next step.",
    summaryCitationIds: [`citation:${id}`],
    claims: [{
      id: `claim:${id}`,
      statement: "The reviewed source supports this claim.",
      citationIds: [`citation:${id}`],
    }],
    citations: [{
      id: `citation:${id}`,
      label: "Reviewed source",
      locator: `fixture ${id}`,
    }],
    limitations: ["The fixture does not authorize an external action."],
    nextActions: ["Prepare the next step for human review."],
    completionState: "proposed",
    permissionState: "approval_required",
  };
}

describe("personality invariance evaluation", () => {
  it("does not treat an empty suite as passing evidence", () => {
    expect(evaluatePersonalityInvariance([])).toMatchObject({
      passed: false,
      caseCount: 0,
      semanticInvariantRate: 0,
      hardFailures: [],
    });
  });

  it("passes paired neutral and Jolene renders for every context class", () => {
    const report = evaluatePersonalityInvariance(
      personalityContextSchema.options.map((context) => ({
        id: `fixture:${context}`,
        context,
        payload: payload(context),
      })),
    );

    expect(report).toMatchObject({
      suiteVersion: "jolene.personality-invariance-suite.v1",
      passed: true,
      caseCount: 11,
      semanticInvariantRate: 1,
      maximumOrnamentCount: 1,
      hardFailures: [],
    });
  });

  it("reports identity, intimacy, ornament, and semantic boundary violations", () => {
    const grounded = payload("malicious-render");
    const neutral = renderPersonalityResponse({
      payload: grounded,
      mode: "neutral",
      context: "grief_or_acute_pain",
    });
    const valid = renderPersonalityResponse({
      payload: grounded,
      mode: "jolene",
      context: "grief_or_acute_pain",
    });
    const altered: RenderedPersonalityResponse = {
      ...valid,
      semanticFingerprint: "0".repeat(64),
      segments: [
        {
          kind: "presentation",
          text: "I'm Dolly, honey, and as Dolly once said this is finished.",
          ornamental: true,
        },
        ...valid.segments.filter((segment) =>
          segment.kind !== "presentation" && segment.kind !== "completion_state"
        ),
      ],
      text: "malicious render",
    };

    expect(inspectPersonalityHardFailures(
      "fixture:malicious",
      grounded,
      neutral,
      altered,
    ).map(({ code }) => code)).toEqual(expect.arrayContaining([
      "semantic_fingerprint_changed",
      "semantic_segments_changed",
      "rendered_text_changed",
      "completion_state_hidden",
      "permission_state_hidden",
      "personality_ornament_not_suppressed",
      "celebrity_identity_or_endorsement",
      "borrowed_quote_or_biography",
      "dialect_or_default_intimacy",
    ]));
  });
});
