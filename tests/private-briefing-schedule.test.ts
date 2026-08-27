import { describe, expect, it } from "vitest";

import { nextPrivateBriefingOccurrence } from "../src/domain/private-briefing-schedule.js";
import type { PrivateBriefingPolicy } from "../src/domain/private-briefing.js";

describe("private briefing wall-clock schedule", () => {
  it("keeps the configured Pacific morning across the DST boundary", () => {
    expect(nextPrivateBriefingOccurrence(
      new Date("2026-03-07T16:01:00.000Z"),
      policy(),
    ).toISOString()).toBe("2026-03-08T15:00:00.000Z");
    expect(nextPrivateBriefingOccurrence(
      new Date("2026-11-01T16:01:00.000Z"),
      policy(),
    ).toISOString()).toBe("2026-11-02T16:00:00.000Z");
  });

  it("supports a bounded weekly cadence", () => {
    expect(nextPrivateBriefingOccurrence(
      new Date("2026-08-26T16:00:00.000Z"),
      policy({ frequency: "weekly", dayOfWeek: 1 }),
    ).toISOString()).toBe("2026-08-31T15:00:00.000Z");
  });
});

function policy(overrides: Partial<PrivateBriefingPolicy> = {}): PrivateBriefingPolicy {
  return {
    enabled: true,
    destination: "slack_owner_dm",
    frequency: "daily",
    dayOfWeek: null,
    localHour: 8,
    localMinute: 0,
    timeZone: "America/Los_Angeles",
    maxDeliveriesPerDay: 1,
    stopAfterDeliveries: 365,
    historyLimit: 90,
    maxAttempts: 5,
    ...overrides,
  };
}
