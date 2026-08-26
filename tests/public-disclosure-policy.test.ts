import { describe, expect, it } from "vitest";

import {
  assertPublicResponseDisclosureSafe,
  containsForbiddenPublicDisclosure,
  containsForbiddenPublicText,
  isPrivateHostname,
} from "../src/domain/public-disclosure-policy.js";

describe("public disclosure policy", () => {
  it.each([
    "/Users/carl/private-note.md",
    "C:\\Users\\carl\\Desktop\\secret.txt",
    "obsidian://open?vault=Brain",
    "See [[Private Career Notes]]",
    `token sk-${"a".repeat(24)}`,
    "Email recruiter@example.com",
    "Call (805) 555-1212",
    "Internal http://127.0.0.1:8421/memory",
    "Internal https://service.internal/status",
  ])("rejects forbidden public text: %s", (value) => {
    expect(containsForbiddenPublicText(value)).toBe(true);
  });

  it.each([
    "Reviewed public evidence is unavailable.",
    "https://github.com/carlwelchdesign/jolene-ai",
    "/portfolio/projects/jolene",
    "Version 2026.08.26",
    "React, TypeScript, and product engineering",
  ])("allows public-safe text: %s", (value) => {
    expect(containsForbiddenPublicText(value)).toBe(false);
  });

  it("finds a leak in nested values without inspecting object keys", () => {
    expect(containsForbiddenPublicDisclosure({
      email: "This key is harmless without a contact value.",
      nested: [{ limitation: "Read file:///Users/carl/private.md" }],
    })).toBe(true);
    expect(containsForbiddenPublicDisclosure({
      email: "No contact information is included.",
    })).toBe(false);
  });

  it("handles cyclic objects deterministically", () => {
    const value: { self?: unknown; text: string } = { text: "Public evidence" };
    value.self = value;
    expect(containsForbiddenPublicDisclosure(value)).toBe(false);
    expect(() => assertPublicResponseDisclosureSafe(value)).not.toThrow();
  });

  it.each([
    "localhost",
    "app.localhost",
    "service.local",
    "service.internal",
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.1",
    "::1",
    "fd00::1",
  ])("identifies private hostname %s", (hostname) => {
    expect(isPrivateHostname(hostname)).toBe(true);
  });

  it.each(["github.com", "portfolio.example", "8.8.8.8"])(
    "allows public hostname %s",
    (hostname) => expect(isPrivateHostname(hostname)).toBe(false),
  );
});
