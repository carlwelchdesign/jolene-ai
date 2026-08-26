import { describe, expect, it } from "vitest";

import { FixedWindowPublicRequestAdmission } from "../src/public/public-request-admission.js";

describe("FixedWindowPublicRequestAdmission", () => {
  it("limits each client within a fixed window and reports reset time", () => {
    let now = 1_000;
    const admission = new FixedWindowPublicRequestAdmission({
      requestsPerWindow: 2,
      maxConcurrentRequests: 2,
      windowMilliseconds: 10_000,
      now: () => now,
    });

    const first = admission.acquire("client-a");
    expect(first.accepted).toBe(true);
    if (first.accepted) first.release();
    const second = admission.acquire("client-a");
    expect(second.accepted).toBe(true);
    if (second.accepted) second.release();

    expect(admission.acquire("client-a")).toEqual({
      accepted: false,
      status: 429,
      code: "rate_limited",
      retryAfterSeconds: 10,
    });

    now = 11_000;
    const reset = admission.acquire("client-a");
    expect(reset.accepted).toBe(true);
    if (reset.accepted) reset.release();
  });

  it("isolates client windows", () => {
    const admission = new FixedWindowPublicRequestAdmission({
      requestsPerWindow: 1,
      maxConcurrentRequests: 2,
    });
    const first = admission.acquire("client-a");
    expect(first.accepted).toBe(true);
    if (first.accepted) first.release();

    expect(admission.acquire("client-a")).toMatchObject({
      accepted: false,
      code: "rate_limited",
    });
    const other = admission.acquire("client-b");
    expect(other.accepted).toBe(true);
    if (other.accepted) other.release();
  });

  it("caps concurrency and releases capacity exactly once", () => {
    const admission = new FixedWindowPublicRequestAdmission({
      requestsPerWindow: 10,
      maxConcurrentRequests: 1,
    });
    const first = admission.acquire("client-a");
    expect(first.accepted).toBe(true);
    expect(admission.acquire("client-b")).toEqual({
      accepted: false,
      status: 503,
      code: "public_delegate_busy",
      retryAfterSeconds: 1,
    });
    if (!first.accepted) throw new Error("Expected admission.");
    first.release();
    first.release();

    const next = admission.acquire("client-b");
    expect(next.accepted).toBe(true);
    if (next.accepted) next.release();
  });

  it("rejects invalid limits", () => {
    expect(() => new FixedWindowPublicRequestAdmission({
      requestsPerWindow: 0,
      maxConcurrentRequests: 1,
    })).toThrow();
    expect(() => new FixedWindowPublicRequestAdmission({
      requestsPerWindow: 1,
      maxConcurrentRequests: 0,
    })).toThrow();
    expect(() => new FixedWindowPublicRequestAdmission({
      requestsPerWindow: 1,
      maxConcurrentRequests: 1,
      windowMilliseconds: 0,
    })).toThrow();
  });
});
