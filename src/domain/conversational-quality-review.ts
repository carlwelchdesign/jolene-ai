import { z } from "zod";

import {
  conversationHardFailureSchema,
  conversationalQualityReviewSchema,
} from "../evaluation/conversational-quality-evaluation.js";

export const conversationalQualityDecisionSchema = z.object({
  schemaVersion: z.literal("jolene.conversation-quality-human-review.v1"),
  suiteId: z.string(),
  packetHash: z.string().regex(/^[a-f0-9]{64}$/),
  model: z.string(),
  reviewedAt: z.string().datetime({ offset: true }),
  reviewer: z.string().trim().min(1).max(120),
  overall: z.enum(["approved", "needs_changes", "rejected"]),
  reviews: z.array(conversationalQualityReviewSchema).min(9).max(40),
  report: z.object({
    gate: z.enum(["pass", "fail"]),
    weightedMean: z.number().min(0).max(4),
    failures: z.array(z.object({
      caseId: z.string(),
      codes: z.array(conversationHardFailureSchema),
    }).strict()),
  }).strict(),
}).strict();

export type ConversationalQualityDecision = z.infer<
  typeof conversationalQualityDecisionSchema
>;
