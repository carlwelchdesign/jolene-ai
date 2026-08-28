import { z } from "zod";

import {
  careerMaturitySchema,
  careerSourceTypeSchema,
  careerVisibilitySchema,
} from "./career-evidence.js";

const sourceProjectionSchema = z.object({
  title: z.string().trim().min(1),
  sourceType: careerSourceTypeSchema,
  publicCitation: z.string().trim().min(1),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

const claimProjectionSchema = z.object({
  claimId: z.string().uuid().nullable(),
  title: z.string().trim().min(1),
  text: z.string().trim().min(1),
  contribution: z.string().trim().min(1),
  maturity: careerMaturitySchema,
  visibility: careerVisibilitySchema,
}).strict();

const claimChangeSchema = z.object({
  logicalKey: z.string().trim().min(1),
  status: z.enum(["added", "changed", "unchanged", "withdrawn"]),
  before: claimProjectionSchema.nullable(),
  after: claimProjectionSchema.nullable(),
}).strict().superRefine((change, context) => {
  if (change.status === "added" && (change.before || !change.after)) {
    context.addIssue({ code: "custom", message: "Added claims require only an after projection." });
  }
  if (change.status === "withdrawn" && (!change.before || change.after)) {
    context.addIssue({ code: "custom", message: "Withdrawn claims require only a before projection." });
  }
  if (["changed", "unchanged"].includes(change.status) && (!change.before || !change.after)) {
    context.addIssue({ code: "custom", message: "Compared claims require before and after projections." });
  }
});

const sourceChangeSchema = z.object({
  sourceId: z.string().trim().min(1),
  changedFields: z.array(z.enum([
    "new_source",
    "source_content",
    "title",
    "source_type",
    "public_citation",
    "claim_set",
  ])).min(1),
  before: sourceProjectionSchema.nullable(),
  after: sourceProjectionSchema,
  claims: z.array(claimChangeSchema),
}).strict();

export const portfolioEvidenceImportReviewPacketSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  packetHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  generatedAt: z.string().datetime({ offset: true }),
  scope: z.object({
    actorId: z.string().trim().min(1),
    workspaceId: z.string().trim().min(1),
  }).strict(),
  summary: z.object({
    eligiblePublicClaimsBefore: z.number().int().nonnegative(),
    eligiblePublicClaimsAfter: z.number().int().nonnegative(),
    changedSources: z.number().int().nonnegative(),
    changedClaims: z.number().int().nonnegative(),
  }).strict(),
  sources: z.array(sourceChangeSchema),
}).strict().superRefine((packet, context) => {
  if (packet.summary.changedSources !== packet.sources.length) {
    context.addIssue({ code: "custom", message: "Changed source count must match packet entries." });
  }
  const changedClaims = packet.sources.flatMap((source) => source.claims)
    .filter((claim) => claim.status !== "unchanged").length;
  if (packet.summary.changedClaims !== changedClaims) {
    context.addIssue({ code: "custom", message: "Changed claim count must match packet entries." });
  }
});

export type PortfolioEvidenceImportReviewPacket = z.infer<
  typeof portfolioEvidenceImportReviewPacketSchema
>;
