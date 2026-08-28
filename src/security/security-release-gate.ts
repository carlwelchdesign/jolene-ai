import { z } from "zod";

export const securityEvidenceClassSchema = z.enum([
  "deterministic",
  "live_model",
  "privacy",
  "owner_approval",
  "deployment",
]);

export type SecurityEvidenceClass = z.infer<typeof securityEvidenceClassSchema>;

const evidenceHashSchema = z.string().regex(/^[a-f0-9]{64}$/);

const presentEvidenceSchema = z.object({
  evidenceClass: securityEvidenceClassSchema,
  status: z.enum(["passed", "failed"]),
  observedAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
  subjectHash: evidenceHashSchema,
  expectedSubjectHash: evidenceHashSchema,
}).strict();

const missingEvidenceSchema = z.object({
  evidenceClass: securityEvidenceClassSchema,
  status: z.literal("missing"),
}).strict();

export const securityEvidenceSchema = z.discriminatedUnion("status", [
  presentEvidenceSchema,
  missingEvidenceSchema,
]);

export type SecurityEvidence = z.infer<typeof securityEvidenceSchema>;

export const securityReleasePacketSchema = z.object({
  schemaVersion: z.literal("jolene.security-release-evidence.v1"),
  releaseId: z.string().regex(/^release:[a-f0-9]{32}$/),
  evidence: z.array(securityEvidenceSchema).length(5),
}).strict().superRefine((packet, context) => {
  const classes = packet.evidence.map((item) => item.evidenceClass);
  if (new Set(classes).size !== securityEvidenceClassSchema.options.length) {
    context.addIssue({
      code: "custom",
      message: "Release evidence must contain each required class exactly once.",
      path: ["evidence"],
    });
  }
  for (const required of securityEvidenceClassSchema.options) {
    if (!classes.includes(required)) {
      context.addIssue({
        code: "custom",
        message: `Missing required evidence class: ${required}.`,
        path: ["evidence"],
      });
    }
  }
});

export type SecurityReleasePacket = z.infer<typeof securityReleasePacketSchema>;

export interface SecurityReleaseBlocker {
  readonly evidenceClass: SecurityEvidenceClass;
  readonly reason: "missing" | "failed" | "changed" | "stale";
}

export interface SecurityReleaseDecision {
  readonly schemaVersion: "jolene.security-release-decision.v1";
  readonly releaseId: string;
  readonly evaluatedAt: string;
  readonly blockers: readonly SecurityReleaseBlocker[];
  readonly status: "passed" | "blocked";
}

export function evaluateSecurityRelease(
  untrustedPacket: unknown,
  evaluatedAt: string,
): SecurityReleaseDecision {
  const packet = securityReleasePacketSchema.parse(untrustedPacket);
  const now = parseTimestamp(evaluatedAt);
  const blockers: SecurityReleaseBlocker[] = [];

  for (const item of packet.evidence) {
    if (item.status === "missing") {
      blockers.push({ evidenceClass: item.evidenceClass, reason: "missing" });
      continue;
    }
    if (item.status === "failed") {
      blockers.push({ evidenceClass: item.evidenceClass, reason: "failed" });
    }
    if (item.subjectHash !== item.expectedSubjectHash) {
      blockers.push({ evidenceClass: item.evidenceClass, reason: "changed" });
    }
    if (now >= parseTimestamp(item.expiresAt)) {
      blockers.push({ evidenceClass: item.evidenceClass, reason: "stale" });
    }
    if (parseTimestamp(item.observedAt) > now) {
      throw new Error(`${item.evidenceClass} evidence cannot be observed in the future.`);
    }
  }

  return {
    schemaVersion: "jolene.security-release-decision.v1",
    releaseId: packet.releaseId,
    evaluatedAt: now.toISOString(),
    blockers,
    status: blockers.length === 0 ? "passed" : "blocked",
  };
}

function parseTimestamp(value: string): Date {
  const parsed = z.string().datetime({ offset: true }).parse(value);
  const date = new Date(parsed);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid release evidence timestamp.");
  return date;
}
