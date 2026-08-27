import type { ChannelKind } from "./conversation.js";
import { evaluatePolicy, type CapabilityRisk } from "./policy.js";

export const CAPABILITY_IDS = Object.freeze([
  "knowledge.search",
  "career_evidence.search",
  "work_status.review",
  "watched_projects.list",
  "watched_projects.review",
  "external_message.send",
] as const);

export type CapabilityId = (typeof CAPABILITY_IDS)[number];
export type CapabilityDataClass =
  | "general"
  | "private"
  | "restricted"
  | "sensitive";
export type CapabilityAuditMechanism =
  | "capability_invocation"
  | "knowledge_access"
  | "career_retrieval"
  | "action_approval";
export type CapabilityRuntime = "model_read_only" | "proposal_only";

export interface CapabilityDefinition {
  readonly id: CapabilityId;
  readonly label: string;
  readonly owner: "carl";
  readonly dataClasses: readonly CapabilityDataClass[];
  readonly baseRisk: CapabilityRisk;
  readonly allowedContexts: readonly ["private"];
  readonly approval: "not_required" | "exact_arguments_required";
  readonly audit: readonly CapabilityAuditMechanism[];
  readonly runtime: CapabilityRuntime;
  readonly modelToolName: string | null;
  readonly inputContract: string;
  readonly outputContract: string;
}

const CAPABILITIES: readonly CapabilityDefinition[] = [
  {
    id: "knowledge.search",
    label: "Search approved private Obsidian knowledge",
    owner: "carl",
    dataClasses: ["general", "restricted"],
    baseRisk: "read_private",
    allowedContexts: ["private"],
    approval: "not_required",
    audit: ["capability_invocation", "knowledge_access"],
    runtime: "model_read_only",
    modelToolName: "search_obsidian",
    inputContract: "knowledge.search.input.v1",
    outputContract: "knowledge.search.output.v1",
  },
  {
    id: "career_evidence.search",
    label: "Search approved professional evidence",
    owner: "carl",
    dataClasses: ["restricted"],
    baseRisk: "read_private",
    allowedContexts: ["private"],
    approval: "not_required",
    audit: ["capability_invocation", "career_retrieval"],
    runtime: "model_read_only",
    modelToolName: "search_career_evidence",
    inputContract: "career_evidence.search.input.v1",
    outputContract: "career_evidence.search.output.v1",
  },
  {
    id: "work_status.review",
    label: "Review private task and workflow status",
    owner: "carl",
    dataClasses: ["restricted"],
    baseRisk: "read_private",
    allowedContexts: ["private"],
    approval: "not_required",
    audit: ["capability_invocation"],
    runtime: "model_read_only",
    modelToolName: "review_work_status",
    inputContract: "work_status.review.input.v1",
    outputContract: "work_status.review.output.v1",
  },
  {
    id: "watched_projects.list",
    label: "List configured private watched projects",
    owner: "carl",
    dataClasses: ["restricted"],
    baseRisk: "read_private",
    allowedContexts: ["private"],
    approval: "not_required",
    audit: ["capability_invocation"],
    runtime: "model_read_only",
    modelToolName: "list_watched_projects",
    inputContract: "watched_projects.list.input.v1",
    outputContract: "watched_projects.list.output.v1",
  },
  {
    id: "watched_projects.review",
    label: "Review one configured watched project",
    owner: "carl",
    dataClasses: ["restricted"],
    baseRisk: "read_private",
    allowedContexts: ["private"],
    approval: "not_required",
    audit: ["capability_invocation"],
    runtime: "model_read_only",
    modelToolName: "review_watched_project",
    inputContract: "watched_projects.review.input.v1",
    outputContract: "watched_projects.review.output.v1",
  },
  {
    id: "external_message.send",
    label: "Send a message to an external recipient",
    owner: "carl",
    dataClasses: ["general", "private", "restricted", "sensitive"],
    baseRisk: "external_write",
    allowedContexts: ["private"],
    approval: "exact_arguments_required",
    audit: ["action_approval"],
    runtime: "proposal_only",
    modelToolName: null,
    inputContract: "external_message.send.proposal.input.v1",
    outputContract: "external_message.send.proposal.output.v1",
  },
] as const;

freezeRegistry(CAPABILITIES);
assertRegistry(CAPABILITIES);

export function listCapabilities(): readonly CapabilityDefinition[] {
  return CAPABILITIES;
}

export function requireCapability(id: CapabilityId): CapabilityDefinition {
  const capability = CAPABILITIES.find((candidate) => candidate.id === id);
  if (!capability) throw new Error(`Unknown capability: ${String(id)}`);
  return capability;
}

export function requireModelCapability(
  id: CapabilityId,
  channelKind: ChannelKind,
): CapabilityDefinition & { readonly modelToolName: string } {
  const capability = requireCapability(id);
  const decision = evaluatePolicy({
    risk: capability.baseRisk,
    channelKind,
    explicitlyRequested: false,
  });
  if (
    capability.runtime !== "model_read_only" ||
    capability.modelToolName === null ||
    decision.outcome !== "allow"
  ) {
    throw new CapabilityContextError();
  }
  return capability as CapabilityDefinition & { readonly modelToolName: string };
}

export function canExposeModelCapability(
  id: CapabilityId,
  channelKind: ChannelKind,
): boolean {
  try {
    requireModelCapability(id, channelKind);
    return true;
  } catch (error) {
    if (error instanceof CapabilityContextError) return false;
    throw error;
  }
}

export class CapabilityContextError extends Error {
  constructor() {
    super("The capability is unavailable in this execution context.");
    this.name = "CapabilityContextError";
  }
}

function assertRegistry(capabilities: readonly CapabilityDefinition[]): void {
  if (capabilities.length !== CAPABILITY_IDS.length) {
    throw new Error("Capability registry inventory is incomplete.");
  }
  if (new Set(capabilities.map(({ id }) => id)).size !== capabilities.length) {
    throw new Error("Capability registry IDs must be unique.");
  }
  const toolNames = capabilities.map(({ modelToolName }) => modelToolName)
    .filter((name): name is string => name !== null);
  if (new Set(toolNames).size !== toolNames.length) {
    throw new Error("Model tool names must be unique.");
  }
  for (const id of CAPABILITY_IDS) {
    if (!capabilities.some((capability) => capability.id === id)) {
      throw new Error(`Capability registry is missing ${id}.`);
    }
  }
}

function freezeRegistry(capabilities: readonly CapabilityDefinition[]): void {
  for (const capability of capabilities) {
    Object.freeze(capability.dataClasses);
    Object.freeze(capability.allowedContexts);
    Object.freeze(capability.audit);
    Object.freeze(capability);
  }
  Object.freeze(capabilities);
}
