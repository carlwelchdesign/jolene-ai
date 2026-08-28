import { describe, expect, it } from "vitest";

import { runSecurityTabletop } from "../src/security/security-tabletop.js";

describe("security incident tabletop", () => {
  it("proves containment, quarantine, revocation, rebuild, restore, and approval boundaries", () => {
    const result = runSecurityTabletop();
    expect(result).toMatchObject({
      schemaVersion: "jolene.security-tabletop.v1",
      sourceDisposition: "isolated",
      revokedExportDisposition: "exclude_and_delete",
      indexDisposition: "delete_then_rebuild_from_active_sources",
      restoreDisposition: "offline_validation_only",
      regressionCapture: "fixture_and_content_free_event_required",
      escalationOwner: "Carl",
      reenableAuthority: "Carl_explicit_approval_required",
      reenabledCapabilities: [],
      status: "passed",
    });
    expect(result.containedCapabilities).toHaveLength(8);
    expect(result.steps).toHaveLength(10);
    expect(result.evidenceHash).toMatch(/^[a-f0-9]{64}$/);
  });
});
