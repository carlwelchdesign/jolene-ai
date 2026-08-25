import type { CapabilityRisk } from "./policy.js";

export type CapabilityId = "external_message.send";

export interface CapabilityDefinition {
  readonly id: CapabilityId;
  readonly label: string;
  readonly baseRisk: CapabilityRisk;
  readonly allowedContexts: readonly ["private"];
  readonly approval: "exact_arguments_required";
  readonly audit: "required";
  readonly runtime: "proposal_only";
}

const CAPABILITIES: readonly CapabilityDefinition[] = [
  {
    id: "external_message.send",
    label: "Send a message to an external recipient",
    baseRisk: "external_write",
    allowedContexts: ["private"],
    approval: "exact_arguments_required",
    audit: "required",
    runtime: "proposal_only",
  },
];

export function listCapabilities(): readonly CapabilityDefinition[] {
  return CAPABILITIES;
}

export function requireCapability(id: CapabilityId): CapabilityDefinition {
  const capability = CAPABILITIES.find((candidate) => candidate.id === id);
  if (!capability) throw new Error(`Unknown capability: ${String(id)}`);
  return capability;
}
