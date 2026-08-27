import { describe, expect, it } from "vitest";

import {
  PERSONALITY_ORNAMENT_SUPPRESSED_CONTEXTS,
  fingerprintGroundedResponse,
  groundedResponsePayloadSchema,
  personalityContextSchema,
  renderPersonalityResponse,
  semanticSegments,
  type GroundedResponsePayload,
} from "../src/personality/personality-renderer.js";

const payload = (): GroundedResponsePayload => ({
  schemaVersion: "jolene.personality-renderer.v1",
  responseId: "response:renderer-test",
  summary: "The API rollout is healthy and the human review queue remains open.",
  summaryCitationIds: ["runtime:health"],
  claims: [{
    id: "claim:api-health",
    statement: "The private API health check passed.",
    citationIds: ["runtime:health"],
  }],
  citations: [{
    id: "runtime:health",
    label: "Canonical health check",
    locator: "private loopback runtime verification",
  }],
  limitations: ["No relationship candidate was approved by this check."],
  nextActions: ["Carl reviews the pending relationship candidates."],
  completionState: "in_progress",
  permissionState: "approval_required",
});

describe("personality renderer", () => {
  it("validates exact grounded citations and produces a stable fingerprint", () => {
    const first = fingerprintGroundedResponse(payload());
    const second = fingerprintGroundedResponse({ ...payload() });

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(second).toBe(first);
    expect(() => groundedResponsePayloadSchema.parse({
      ...payload(),
      summaryCitationIds: ["runtime:missing"],
    })).toThrow("Summary references unknown citations");
    expect(() => groundedResponsePayloadSchema.parse({
      ...payload(),
      claims: [{
        id: "claim:missing-citation",
        statement: "This citation does not exist.",
        citationIds: ["runtime:missing"],
      }],
    })).toThrow("unknown citations");
    expect(() => groundedResponsePayloadSchema.parse({
      ...payload(),
      citations: [payload().citations[0], payload().citations[0]],
    })).toThrow("Citation IDs must be unique");
  });

  it("keeps every semantic segment identical across modes and contexts", () => {
    for (const context of personalityContextSchema.options) {
      const neutral = renderPersonalityResponse({
        payload: payload(),
        mode: "neutral",
        context,
      });
      const jolene = renderPersonalityResponse({
        payload: payload(),
        mode: "jolene",
        context,
      });

      expect(jolene.semanticFingerprint).toBe(neutral.semanticFingerprint);
      expect(semanticSegments(jolene)).toEqual(semanticSegments(neutral));
      expect(jolene.text).toContain("Completion: in_progress");
      expect(jolene.text).toContain("Permission: approval_required");
      expect(jolene.segments.filter((segment) => segment.ornamental)).toHaveLength(
        PERSONALITY_ORNAMENT_SUPPRESSED_CONTEXTS.has(context) ? 0 : 1,
      );
    }
  });

  it("removes all presentation text in neutral mode", () => {
    const rendered = renderPersonalityResponse({
      payload: payload(),
      mode: "neutral",
      context: "celebration",
    });

    expect(rendered.segments.some((segment) => segment.kind === "presentation"))
      .toBe(false);
    expect(rendered.segments.some((segment) => segment.ornamental)).toBe(false);
  });
});
