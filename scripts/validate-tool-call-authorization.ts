import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { listCapabilities } from "../src/domain/capability-registry.js";
import {
  createToolIntentAuthorization,
  IntentBoundToolAuthorizer,
  ToolCallAuthorizationDeniedError,
} from "../src/domain/tool-call-authorization.js";

const receivedAt = "2026-08-27T17:00:00.000Z";
const activeAt = "2026-08-27T17:00:30.000Z";

export interface ToolAuthorizationValidationSummary {
  readonly exactAuthorizationChecks: number;
  readonly adversarialDenialChecks: number;
  readonly scopeChecks: number;
  readonly consequentialBoundaryChecks: number;
  readonly status: "passed";
}

export function validateToolCallAuthorization():
  ToolAuthorizationValidationSummary {
  const exact = authorizer("Search my recipe notes for soup.");
  const permit = exact.authorize(
    "knowledge.search",
    { query: "recipe notes soup", limit: 3 },
    activeAt,
  );
  exact.recordResult(permit, { itemCount: 2, characterCount: 2_000 }, activeAt);

  const denials: Array<() => void> = [
    () => authorizer("Search my recipe notes for soup.").authorize(
      "knowledge.search",
      { query: "recipe notes soup passwords", limit: 3 },
      activeAt,
    ),
    () => {
      const repeated = authorizer("Search my recipe notes for soup.");
      repeated.authorize(
        "knowledge.search",
        { query: "recipe notes soup", limit: 3 },
        activeAt,
      );
      repeated.authorize(
        "knowledge.search",
        { query: "recipe notes soup", limit: 3 },
        activeAt,
      );
    },
    () => {
      const oversized = authorizer("Search my recipe notes for soup.");
      const resultPermit = oversized.authorize(
        "knowledge.search",
        { query: "recipe notes soup", limit: 3 },
        activeAt,
      );
      oversized.recordResult(resultPermit, {
        itemCount: 2,
        characterCount: 40_001,
      }, activeAt);
    },
    () => new IntentBoundToolAuthorizer(createToolIntentAuthorization({
      ...authorizationInput("Search my recipe notes for soup."),
      intentSource: {
        source: "authenticated_current_user_turn",
        authority: "user",
        taintIds: ["retrieved:claim"] as unknown as readonly never[],
        derivationIds: [],
      },
    })),
  ];
  for (const denial of denials) expectDenial(denial);

  expectDenial(() => createToolIntentAuthorization({
    ...authorizationInput("Search my recipe notes for soup."),
    channelKind: "slack_shared",
    disclosureCeiling: "local_private",
  }));
  expectDenial(() => createToolIntentAuthorization({
    ...authorizationInput("Search my recipe notes for soup."),
    channelKind: "slack_dm",
    disclosureCeiling: "local_private",
  }));

  const consequential = listCapabilities().filter((capability) =>
    capability.baseRisk === "external_write" ||
    capability.baseRisk === "sensitive_disclosure"
  );
  assert(consequential.length === 1,
    "Unexpected consequential capability count.");
  assert(consequential.every((capability) =>
    capability.runtime === "proposal_only" &&
    capability.modelToolName === null &&
    capability.approval === "exact_arguments_required"
  ), "A consequential capability is exposed as a model tool.");

  return {
    exactAuthorizationChecks: 2,
    adversarialDenialChecks: denials.length,
    scopeChecks: 2,
    consequentialBoundaryChecks: consequential.length,
    status: "passed",
  };
}

function authorizer(message: string): IntentBoundToolAuthorizer {
  return new IntentBoundToolAuthorizer(createToolIntentAuthorization(
    authorizationInput(message),
  ));
}

function authorizationInput(currentMessage: string) {
  return {
    eventId: "validator-event",
    actorId: "validator-owner",
    workspaceId: "validator-workspace",
    channelKind: "private_chat" as const,
    channelId: "validator-channel",
    threadId: "validator-thread",
    disclosureCeiling: "local_private" as const,
    currentMessage,
    receivedAt,
    availableCapabilityIds: ["knowledge.search"] as const,
  };
}

function expectDenial(operation: () => unknown): void {
  try {
    operation();
  } catch (error) {
    if (error instanceof ToolCallAuthorizationDeniedError) return;
    throw error;
  }
  throw new Error("Expected the tool authorization gate to deny the operation.");
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.stdout.write(
    `${JSON.stringify(validateToolCallAuthorization(), null, 2)}\n`,
  );
}
