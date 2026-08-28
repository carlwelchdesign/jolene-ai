import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  detectPrivateRagCollectionRiskSignals,
  detectPrivateRagRiskSignals,
} from
  "../src/application/private-rag-provider-gate.js";
import {
  promptInjectionAttackFamilySchema,
  promptInjectionRedTeamSuiteSchema,
  promptInjectionSurfaceSchema,
  validatePromptInjectionCrossChannelCoverage,
} from "../src/evaluation/prompt-injection-red-team-contract.js";
import {
  createUntrustedContentEnvelope,
  type UntrustedContentOriginKind,
} from "../src/domain/untrusted-content.js";

const suite = promptInjectionRedTeamSuiteSchema.parse(JSON.parse(readFileSync(
  new URL("../evaluations/prompt-injection-cross-channel-v1.json", import.meta.url),
  "utf8",
)));

describe("prompt-injection cross-channel deterministic matrix", () => {
  it("covers every declared surface and attack family", () => {
    expect(validatePromptInjectionCrossChannelCoverage(suite).suiteId).toBe(suite.suiteId);
    expect(new Set(suite.cases.map(({ surface }) => surface)))
      .toEqual(new Set(promptInjectionSurfaceSchema.options));
    expect(new Set(suite.cases.map(({ family }) => family)))
      .toEqual(new Set(promptInjectionAttackFamilySchema.options));
  });

  it("pins every case to an existing boundary regression", () => {
    for (const fixture of suite.cases) {
      for (const testRef of fixture.boundaryTestRefs) {
        expect(existsSync(resolve(process.cwd(), testRef)), `${fixture.id}: ${testRef}`)
          .toBe(true);
      }
    }
  });

  it.each(suite.cases)("$id remains authority-none and detects the attack", (fixture) => {
    const envelopes = fixture.fixture.fragments.map((text, index) =>
      createUntrustedContentEnvelope({
        origin: {
          kind: originKind(fixture.source.kind),
          sourceId: `${fixture.id}:${index}`,
        },
        scope: {
          actorId: "synthetic-owner",
          workspaceId: "synthetic-workspace",
          channelKind: fixture.surface,
          channelId: "synthetic-channel",
          threadId: "synthetic-thread",
        },
        classification: fixture.surface.startsWith("public_") ? "public" : "private",
        purpose: "retrieval_evidence",
        disclosureCeiling: fixture.surface.startsWith("public_")
          ? "public"
          : "owner_only",
        review: fixture.source.taint === "approved_but_non_authoritative"
          ? { status: "approved", reviewedAt: "2026-08-27T00:00:00.000Z" }
          : { status: "unreviewed", reviewedAt: null },
        freshness: {
          observedAt: "2026-08-27T00:00:00.000Z",
          expiresAt: null,
          status: "fresh",
        },
        revocation: { status: "active", revokedAt: null, reasonCode: null },
        payload: { kind: "text", text },
        taintIds: [`taint:${fixture.id}:${index}`],
      })
    );
    expect(envelopes.every(({ authority }) => authority === "none")).toBe(true);
    expect(envelopes.every(({ lineage }) => lineage.taintIds.length > 0)).toBe(true);
    const signals = new Set([
      ...envelopes.flatMap((envelope) => detectPrivateRagRiskSignals(envelope)),
      ...detectPrivateRagCollectionRiskSignals(envelopes),
    ]);
    for (const expected of fixture.fixture.expectedRiskSignals) {
      expect(signals, `${fixture.id} missing ${expected}`).toContain(expected);
    }
  });
});

function originKind(source: string): UntrustedContentOriginKind {
  switch (source) {
    case "visitor_input":
    case "owner_input": return "user_message";
    case "retrieved_evidence": return "career_evidence";
    case "obsidian_note": return "obsidian_excerpt";
    case "memory_or_history": return "conversation_quotation";
    case "task_event": return "task_event";
    case "tool_result": return "tool_result";
    case "external_ai_packet": return "external_ai_text";
    case "provider_output": return "tool_result";
    default: throw new Error(`Unsupported synthetic source kind: ${source}`);
  }
}
