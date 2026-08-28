import { describe, expect, it } from "vitest";

import {
  DEFAULT_RETENTION_POLICIES,
  decideLifecycle,
  OperationalCapabilityDisabledError,
  OperationalKillSwitches,
} from "../src/security/operations-governance.js";

describe("retention governance", () => {
  it("defines a validated lifecycle policy for every governed data class", () => {
    expect(Object.keys(DEFAULT_RETENTION_POLICIES)).toHaveLength(12);
    expect(DEFAULT_RETENTION_POLICIES.contact_intent).toMatchObject({
      ttlDays: 30,
      revocationAction: "delete",
    });
    expect(DEFAULT_RETENTION_POLICIES.retrieval_index).toMatchObject({
      ttlDays: 30,
      supportsSecurityHold: false,
      revocationAction: "exclude_and_delete",
    });
  });

  it("deletes expired records and retains active records only to their deadline", () => {
    expect(decideLifecycle({
      dataClass: "conversation",
      state: "active",
      createdAt: "2026-07-01T00:00:00.000Z",
      securityHold: false,
      now: "2026-08-27T00:00:00.000Z",
    })).toMatchObject({ action: "delete", reason: "ttl_expired" });

    expect(decideLifecycle({
      dataClass: "cache_entry",
      state: "active",
      createdAt: "2026-08-27T00:00:00.000Z",
      securityHold: false,
      now: "2026-08-27T12:00:00.000Z",
    })).toEqual({
      action: "retain",
      reason: "active_within_ttl",
      deleteAfter: "2026-08-28T00:00:00.000Z",
    });
  });

  it("isolates quarantine, honors supported security holds, and removes revocations", () => {
    expect(decideLifecycle({
      dataClass: "provider_operation",
      state: "quarantined",
      createdAt: "2026-08-25T00:00:00.000Z",
      securityHold: false,
      now: "2026-08-27T00:00:00.000Z",
    })).toMatchObject({ action: "isolate", reason: "quarantine_active" });

    expect(decideLifecycle({
      dataClass: "audit_event",
      state: "revoked",
      createdAt: "2026-08-01T00:00:00.000Z",
      securityHold: true,
      now: "2026-08-27T00:00:00.000Z",
    })).toEqual({ action: "retain", reason: "security_hold", deleteAfter: null });

    expect(decideLifecycle({
      dataClass: "public_export",
      state: "revoked",
      createdAt: "2026-08-01T00:00:00.000Z",
      securityHold: false,
      now: "2026-08-27T00:00:00.000Z",
    })).toEqual({
      action: "exclude_and_delete",
      reason: "owner_revoked",
      deleteAfter: "2026-08-27T00:00:00.000Z",
    });
  });

  it("rejects unsupported holds and impossible timelines", () => {
    expect(() => decideLifecycle({
      dataClass: "retrieval_index",
      state: "active",
      createdAt: "2026-08-01T00:00:00.000Z",
      securityHold: true,
      now: "2026-08-27T00:00:00.000Z",
    })).toThrow("does not support a security hold");

    expect(() => decideLifecycle({
      dataClass: "conversation",
      state: "active",
      createdAt: "2026-08-28T00:00:00.000Z",
      securityHold: false,
      now: "2026-08-27T00:00:00.000Z",
    })).toThrow("cannot precede creation time");
  });
});

describe("OperationalKillSwitches", () => {
  it("fails closed for every capability by default", () => {
    const switches = new OperationalKillSwitches();
    expect(Object.values(switches.snapshot())).toEqual(Array(8).fill(false));
    expect(() => switches.requireEnabled("private_retrieval")).toThrow(
      OperationalCapabilityDisabledError,
    );
  });

  it("enables each capability independently", () => {
    const switches = OperationalKillSwitches.fromEnvironment({
      JOLENE_ENABLE_PUBLIC_GENERATION: "enabled",
      JOLENE_ENABLE_PUBLIC_DELEGATE: "disabled",
      JOLENE_ENABLE_PRIVATE_RETRIEVAL: "enabled",
      JOLENE_ENABLE_SLACK: "disabled",
      JOLENE_ENABLE_EMBEDDINGS: "enabled",
      JOLENE_ENABLE_EXTERNAL_AI_EXCHANGE: "disabled",
      JOLENE_ENABLE_CONTACT_CAPTURE: "enabled",
      JOLENE_ENABLE_SOURCE_INGESTION: "disabled",
    });
    expect(switches.snapshot()).toEqual({
      public_generation: true,
      public_delegate: false,
      private_retrieval: true,
      slack: false,
      embeddings: true,
      external_ai_exchange: false,
      contact_capture: true,
      source_ingestion: false,
    });
  });

  it("keeps missing values disabled and rejects ambiguous values", () => {
    expect(OperationalKillSwitches.fromEnvironment({}).snapshot())
      .toEqual(new OperationalKillSwitches().snapshot());
    expect(() => OperationalKillSwitches.fromEnvironment({
      JOLENE_ENABLE_SLACK: "true",
    })).toThrow("JOLENE_ENABLE_SLACK must be either enabled or disabled");
  });

  it("requires both the global ingestion switch and an exact per-source switch", () => {
    const sourceA = `source:${"a".repeat(32)}`;
    const sourceB = `source:${"b".repeat(32)}`;
    const enabled = new OperationalKillSwitches(
      { source_ingestion: true },
      [sourceA],
    );
    expect(enabled.isSourceEnabled(sourceA)).toBe(true);
    expect(enabled.isSourceEnabled(sourceB)).toBe(false);
    expect(() => enabled.requireSourceEnabled(sourceB)).toThrow(
      OperationalCapabilityDisabledError,
    );
    expect(new OperationalKillSwitches({}, [sourceA]).isSourceEnabled(sourceA))
      .toBe(false);
    expect(() => enabled.isSourceEnabled("my-private-file.md")).toThrow();
  });
});
