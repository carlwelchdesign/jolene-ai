import { createHash } from "node:crypto";

import { z } from "zod";

export const RUNTIME_PERSONALITY_ADMISSIONS_VERSION =
  "jolene.runtime-personality-admissions.v1" as const;

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);

const runtimePersonalityAdmissionsSchema = z.object({
  schemaVersion: z.literal(RUNTIME_PERSONALITY_ADMISSIONS_VERSION),
  sourceAuditSchemaVersion: z.literal("jolene.personality-admission-audit.v1"),
  sourceAuditFingerprint: sha256Schema,
  activationDecision: z.literal("owner-authorized-local-runtime-policy"),
  admittedTraits: z.array(z.object({
    traitFamilyId: z.literal("uncertainty-humility"),
    originalDesignedRule: z.string().trim().min(20),
  }).strict()).length(1),
}).strict();

const sourceAdmissionDecisionSchema = z.object({
  traitFamilyId: z.string().trim().min(1),
  decision: z.enum(["admitted", "deferred-insufficient-evidence"]),
  originalDesignedRule: z.string().trim().min(20).nullable(),
  ownerDecision: z.enum(["approved", "not-reached"]),
}).passthrough();

const sourceAdmissionAuditBindingSchema = z.object({
  schemaVersion: z.literal("jolene.personality-admission-audit.v1"),
  status: z.literal("audited-non-activating"),
  traitDecisions: z.array(sourceAdmissionDecisionSchema).length(8),
  admittedTraits: z.array(z.string().trim().min(1)).length(1),
  ownerApprovalBasis: z.literal("standing-owner-approval-for-user-supplied-data"),
  traitAdmissionComplete: z.literal(true),
  runtimeActivation: z.literal("prohibited"),
}).passthrough();

export type RuntimePersonalityAdmissionsV1 = z.infer<
  typeof runtimePersonalityAdmissionsSchema
>;

export const RUNTIME_PERSONALITY_ADMISSIONS =
  runtimePersonalityAdmissionsSchema.parse({
    schemaVersion: RUNTIME_PERSONALITY_ADMISSIONS_VERSION,
    sourceAuditSchemaVersion: "jolene.personality-admission-audit.v1",
    sourceAuditFingerprint:
      "sha256:5154cb0caf2d7726775e69099268877f64e3244912fdb3d60c9f81097ccb4fec",
    activationDecision: "owner-authorized-local-runtime-policy",
    admittedTraits: [{
      traitFamilyId: "uncertainty-humility",
      originalDesignedRule:
        "Jolene states what she knows, names evidence gaps plainly, and asks one useful clarifying question instead of bluffing.",
    }],
  });

export const AUDITED_ADMITTED_PERSONALITY_INSTRUCTIONS: readonly string[] =
  RUNTIME_PERSONALITY_ADMISSIONS.admittedTraits.map(
    (trait) => trait.originalDesignedRule,
  );

export function validateRuntimePersonalityAdmissionsArtifact(
  rawAuditJson: string,
): {
  readonly sourceAuditFingerprint: string;
  readonly admittedTraits: readonly string[];
} {
  const fingerprint = digest(rawAuditJson);
  if (fingerprint !== RUNTIME_PERSONALITY_ADMISSIONS.sourceAuditFingerprint) {
    throw new Error("Runtime personality admission audit fingerprint mismatch");
  }

  const audit = sourceAdmissionAuditBindingSchema.parse(JSON.parse(rawAuditJson));
  const admitted = audit.traitDecisions.filter(
    (decision) => decision.decision === "admitted",
  );
  const runtimeAdmissions = RUNTIME_PERSONALITY_ADMISSIONS.admittedTraits;

  if (admitted.length !== runtimeAdmissions.length) {
    throw new Error("Runtime personality admission count mismatch");
  }

  for (const [index, runtimeAdmission] of runtimeAdmissions.entries()) {
    const decision = admitted[index];
    if (
      decision?.traitFamilyId !== runtimeAdmission.traitFamilyId ||
      decision.ownerDecision !== "approved" ||
      decision.originalDesignedRule !== runtimeAdmission.originalDesignedRule ||
      audit.admittedTraits[index] !== runtimeAdmission.traitFamilyId
    ) {
      throw new Error("Runtime personality admission decision mismatch");
    }
  }

  return {
    sourceAuditFingerprint: fingerprint,
    admittedTraits: runtimeAdmissions.map((trait) => trait.traitFamilyId),
  };
}

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
