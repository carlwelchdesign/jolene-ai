import { z } from "zod";

export const governedDataClassSchema = z.enum([
  "conversation",
  "memory",
  "task_event",
  "client_packet",
  "contact_intent",
  "audit_event",
  "retrieval_index",
  "cache_entry",
  "public_export",
  "provider_operation",
  "backup",
  "quarantine_record",
]);

export type GovernedDataClass = z.infer<typeof governedDataClassSchema>;

export const lifecycleStateSchema = z.enum([
  "active",
  "quarantined",
  "revoked",
  "deleted",
]);

export type LifecycleState = z.infer<typeof lifecycleStateSchema>;

export const retentionPolicySchema = z.object({
  dataClass: governedDataClassSchema,
  ttlDays: z.number().int().min(1).max(3_650).nullable(),
  quarantineTtlDays: z.number().int().min(1).max(365),
  supportsSecurityHold: z.boolean(),
  revocationAction: z.enum(["delete", "exclude_and_delete", "retain_tombstone"]),
}).strict();

export type RetentionPolicy = z.infer<typeof retentionPolicySchema>;

const DAY_MILLISECONDS = 24 * 60 * 60 * 1_000;

export const DEFAULT_RETENTION_POLICIES: Readonly<Record<GovernedDataClass, RetentionPolicy>> =
  Object.freeze({
    conversation: policy("conversation", 30, 14, true, "delete"),
    memory: policy("memory", null, 14, true, "exclude_and_delete"),
    task_event: policy("task_event", 365, 14, true, "retain_tombstone"),
    client_packet: policy("client_packet", 30, 14, true, "delete"),
    contact_intent: policy("contact_intent", 30, 14, true, "delete"),
    audit_event: policy("audit_event", 90, 30, true, "retain_tombstone"),
    retrieval_index: policy("retrieval_index", 30, 7, false, "exclude_and_delete"),
    cache_entry: policy("cache_entry", 1, 1, false, "delete"),
    public_export: policy("public_export", null, 7, true, "exclude_and_delete"),
    provider_operation: policy("provider_operation", 30, 7, true, "delete"),
    backup: policy("backup", 30, 7, true, "delete"),
    quarantine_record: policy("quarantine_record", 30, 30, true, "retain_tombstone"),
  });

export interface LifecycleDecisionInput {
  readonly dataClass: GovernedDataClass;
  readonly state: LifecycleState;
  readonly createdAt: string;
  readonly securityHold: boolean;
  readonly now: string;
}

export interface LifecycleDecision {
  readonly action: "retain" | "isolate" | "delete" | "exclude_and_delete" | "retain_tombstone";
  readonly reason:
    | "active_within_ttl"
    | "retained_until_revoked"
    | "security_hold"
    | "quarantine_active"
    | "quarantine_expired"
    | "ttl_expired"
    | "owner_revoked"
    | "already_deleted";
  readonly deleteAfter: string | null;
}

export function decideLifecycle(input: LifecycleDecisionInput): LifecycleDecision {
  const policy = DEFAULT_RETENTION_POLICIES[input.dataClass];
  const createdAt = parseTimestamp(input.createdAt, "createdAt");
  const now = parseTimestamp(input.now, "now");
  if (now < createdAt) throw new Error("Lifecycle decision time cannot precede creation time.");
  if (input.securityHold && !policy.supportsSecurityHold) {
    throw new Error(`${input.dataClass} does not support a security hold.`);
  }
  if (input.state === "deleted") {
    return { action: "delete", reason: "already_deleted", deleteAfter: null };
  }
  if (input.securityHold) {
    return { action: "retain", reason: "security_hold", deleteAfter: null };
  }
  if (input.state === "revoked") {
    return {
      action: policy.revocationAction,
      reason: "owner_revoked",
      deleteAfter: now.toISOString(),
    };
  }
  if (input.state === "quarantined") {
    const deleteAfter = new Date(createdAt.getTime() + policy.quarantineTtlDays * DAY_MILLISECONDS);
    return now >= deleteAfter
      ? { action: "delete", reason: "quarantine_expired", deleteAfter: deleteAfter.toISOString() }
      : { action: "isolate", reason: "quarantine_active", deleteAfter: deleteAfter.toISOString() };
  }
  if (policy.ttlDays === null) {
    return { action: "retain", reason: "retained_until_revoked", deleteAfter: null };
  }
  const deleteAfter = new Date(createdAt.getTime() + policy.ttlDays * DAY_MILLISECONDS);
  return now >= deleteAfter
    ? { action: "delete", reason: "ttl_expired", deleteAfter: deleteAfter.toISOString() }
    : { action: "retain", reason: "active_within_ttl", deleteAfter: deleteAfter.toISOString() };
}

export const operationalCapabilitySchema = z.enum([
  "public_generation",
  "public_delegate",
  "private_retrieval",
  "slack",
  "embeddings",
  "external_ai_exchange",
  "contact_capture",
  "source_ingestion",
]);

export type OperationalCapability = z.infer<typeof operationalCapabilitySchema>;

const capabilityEnvironmentVariables: Readonly<Record<OperationalCapability, string>> = Object.freeze({
  public_generation: "JOLENE_ENABLE_PUBLIC_GENERATION",
  public_delegate: "JOLENE_ENABLE_PUBLIC_DELEGATE",
  private_retrieval: "JOLENE_ENABLE_PRIVATE_RETRIEVAL",
  slack: "JOLENE_ENABLE_SLACK",
  embeddings: "JOLENE_ENABLE_EMBEDDINGS",
  external_ai_exchange: "JOLENE_ENABLE_EXTERNAL_AI_EXCHANGE",
  contact_capture: "JOLENE_ENABLE_CONTACT_CAPTURE",
  source_ingestion: "JOLENE_ENABLE_SOURCE_INGESTION",
});

export type OperationalCapabilityState = Readonly<Record<OperationalCapability, boolean>>;

export class OperationalKillSwitches {
  readonly #state: OperationalCapabilityState;

  constructor(state: Partial<Record<OperationalCapability, boolean>> = {}) {
    this.#state = Object.freeze(Object.fromEntries(
      operationalCapabilitySchema.options.map((capability) => [capability, state[capability] === true]),
    ) as Record<OperationalCapability, boolean>);
  }

  static fromEnvironment(environment: NodeJS.ProcessEnv): OperationalKillSwitches {
    const state: Partial<Record<OperationalCapability, boolean>> = {};
    for (const capability of operationalCapabilitySchema.options) {
      const variable = capabilityEnvironmentVariables[capability];
      const value = environment[variable];
      if (value === undefined || value === "disabled") state[capability] = false;
      else if (value === "enabled") state[capability] = true;
      else throw new Error(`${variable} must be either enabled or disabled.`);
    }
    return new OperationalKillSwitches(state);
  }

  isEnabled(capability: OperationalCapability): boolean {
    return this.#state[operationalCapabilitySchema.parse(capability)];
  }

  requireEnabled(capability: OperationalCapability): void {
    if (!this.isEnabled(capability)) throw new OperationalCapabilityDisabledError(capability);
  }

  snapshot(): OperationalCapabilityState {
    return { ...this.#state };
  }
}

export class OperationalCapabilityDisabledError extends Error {
  readonly capability: OperationalCapability;

  constructor(capability: OperationalCapability) {
    super(`Operational capability is disabled: ${capability}.`);
    this.name = "OperationalCapabilityDisabledError";
    this.capability = capability;
  }
}

function policy(
  dataClass: GovernedDataClass,
  ttlDays: number | null,
  quarantineTtlDays: number,
  supportsSecurityHold: boolean,
  revocationAction: RetentionPolicy["revocationAction"],
): RetentionPolicy {
  return retentionPolicySchema.parse({
    dataClass,
    ttlDays,
    quarantineTtlDays,
    supportsSecurityHold,
    revocationAction,
  });
}

function parseTimestamp(value: string, label: string): Date {
  const parsed = z.string().datetime({ offset: true }).parse(value);
  const date = new Date(parsed);
  if (!Number.isFinite(date.getTime())) throw new Error(`${label} must be a valid timestamp.`);
  return date;
}
