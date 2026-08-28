import { createHash } from "node:crypto";

import {
  decideLifecycle,
  OperationalKillSwitches,
  type OperationalCapability,
} from "./operations-governance.js";

const containedCapabilities = [
  "public_generation",
  "public_delegate",
  "private_retrieval",
  "slack",
  "embeddings",
  "external_ai_exchange",
  "contact_capture",
  "source_ingestion",
] as const satisfies readonly OperationalCapability[];

export interface SecurityTabletopSummary {
  readonly schemaVersion: "jolene.security-tabletop.v1";
  readonly scenarioId: "indirect-injection-and-credential-exposure";
  readonly steps: readonly string[];
  readonly containedCapabilities: readonly OperationalCapability[];
  readonly sourceDisposition: "isolated";
  readonly revokedExportDisposition: "exclude_and_delete";
  readonly indexDisposition: "delete_then_rebuild_from_active_sources";
  readonly restoreDisposition: "offline_validation_only";
  readonly regressionCapture: "fixture_and_content_free_event_required";
  readonly escalationOwner: "Carl";
  readonly reenableAuthority: "Carl_explicit_approval_required";
  readonly reenabledCapabilities: readonly OperationalCapability[];
  readonly evidenceHash: string;
  readonly status: "passed";
}

export function runSecurityTabletop(): SecurityTabletopSummary {
  const switches = new OperationalKillSwitches();
  const disabled = containedCapabilities.filter((capability) => !switches.isEnabled(capability));
  assert(disabled.length === containedCapabilities.length, "Containment did not disable every capability.");

  const source = decideLifecycle({
    dataClass: "memory",
    state: "quarantined",
    createdAt: "2026-08-27T18:00:00.000Z",
    securityHold: false,
    now: "2026-08-27T18:01:00.000Z",
  });
  assert(source.action === "isolate", "Suspect source was not isolated.");

  const revokedExport = decideLifecycle({
    dataClass: "public_export",
    state: "revoked",
    createdAt: "2026-08-01T00:00:00.000Z",
    securityHold: false,
    now: "2026-08-27T18:02:00.000Z",
  });
  assert(revokedExport.action === "exclude_and_delete", "Revoked export remained eligible.");

  const index = decideLifecycle({
    dataClass: "retrieval_index",
    state: "revoked",
    createdAt: "2026-08-27T18:00:00.000Z",
    securityHold: false,
    now: "2026-08-27T18:03:00.000Z",
  });
  assert(index.action === "exclude_and_delete", "Derived index was not invalidated.");

  const steps = [
    "detect_and_open_incident",
    "disable_independent_capabilities",
    "quarantine_suspect_source",
    "revoke_affected_export",
    "delete_and_rebuild_derived_index",
    "rotate_exposed_credentials",
    "restore_to_offline_validation",
    "capture_regression_fixture_and_content_free_event",
    "escalate_to_owner",
    "await_explicit_reenable_approval",
  ] as const;
  const evidenceHash = createHash("sha256").update(JSON.stringify({
    steps,
    disabled,
    source: source.action,
    revokedExport: revokedExport.action,
    index: index.action,
  })).digest("hex");

  return {
    schemaVersion: "jolene.security-tabletop.v1",
    scenarioId: "indirect-injection-and-credential-exposure",
    steps,
    containedCapabilities: disabled,
    sourceDisposition: "isolated",
    revokedExportDisposition: "exclude_and_delete",
    indexDisposition: "delete_then_rebuild_from_active_sources",
    restoreDisposition: "offline_validation_only",
    regressionCapture: "fixture_and_content_free_event_required",
    escalationOwner: "Carl",
    reenableAuthority: "Carl_explicit_approval_required",
    reenabledCapabilities: [],
    evidenceHash,
    status: "passed",
  };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
