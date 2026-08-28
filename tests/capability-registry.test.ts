import { describe, expect, it } from "vitest";

import { selectModelCapabilityIds } from "../src/agent/agent-runner.js";
import {
  CAPABILITY_IDS,
  CapabilityContextError,
  listCapabilities,
  requireModelCapability,
} from "../src/domain/capability-registry.js";
import { resolveChannelRetrievalPolicy } from "../src/domain/channel-retrieval-policy.js";

describe("capability registry", () => {
  it("inventories every implemented private model tool and proposal boundary", () => {
    const capabilities = listCapabilities();
    expect(capabilities.map(({ id }) => id)).toEqual(CAPABILITY_IDS);
    expect(new Set(capabilities.map(({ id }) => id)).size)
      .toBe(capabilities.length);
    expect(capabilities).toHaveLength(6);
    expect(Object.isFrozen(capabilities)).toBe(true);
    for (const capability of capabilities) {
      expect(Object.isFrozen(capability)).toBe(true);
      expect(Object.isFrozen(capability.dataClasses)).toBe(true);
      expect(Object.isFrozen(capability.audit)).toBe(true);
      expect(capability).toMatchObject({
        owner: "carl",
        allowedContexts: ["private"],
      });
      expect(capability.dataClasses.length).toBeGreaterThan(0);
      expect(capability.audit.length).toBeGreaterThan(0);
      expect(capability.inputContract).toMatch(/\.input\.v1$/);
      expect(capability.outputContract).toMatch(/\.output\.v1$/);
    }
    expect(capabilities.filter(({ runtime }) => runtime === "model_read_only")
      .map(({ modelToolName }) => modelToolName)).toEqual([
      "search_obsidian",
      "search_career_evidence",
      "review_work_status",
      "list_watched_projects",
      "review_watched_project",
    ]);
  });

  it("derives exact private model exposure from registry and availability", () => {
    expect(selectModelCapabilityIds("private_chat", {
      careerSearch: true,
      workStatus: true,
      projectWatch: true,
    })).toEqual([
      "knowledge.search",
      "career_evidence.search",
      "work_status.review",
      "watched_projects.list",
      "watched_projects.review",
    ]);
    expect(selectModelCapabilityIds("private_chat", {
      careerSearch: false,
      workStatus: false,
      projectWatch: false,
    })).toEqual(["knowledge.search"]);
    expect(selectModelCapabilityIds("slack_shared", {
      careerSearch: true,
      workStatus: true,
      projectWatch: true,
    })).toEqual([]);
    expect(selectModelCapabilityIds("slack_dm", {
      careerSearch: true,
      workStatus: true,
      projectWatch: true,
    })).toEqual([]);
    expect(selectModelCapabilityIds("slack_dm", {
      careerSearch: true,
      workStatus: true,
      projectWatch: true,
    }, resolveChannelRetrievalPolicy({
      surface: "slack_dm",
      slackDisclosureScope: "verified_owner_dm",
    }))).toEqual([
      "knowledge.search",
      "career_evidence.search",
      "work_status.review",
      "watched_projects.list",
      "watched_projects.review",
    ]);
  });

  it("cannot expose proposal-only or private-read capabilities in shared context", () => {
    expect(() => requireModelCapability(
      "external_message.send",
      "private_chat",
    )).toThrow(CapabilityContextError);
    expect(() => requireModelCapability(
      "knowledge.search",
      "slack_shared",
    )).toThrow(CapabilityContextError);
  });
});
