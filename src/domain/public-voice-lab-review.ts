import { z } from "zod";

import { publicVoiceLabReviewDimensionSchema } from
  "../evaluation/public-voice-lab-evaluation.js";

const scoreSchema = z.number().int().min(0).max(4);

export const publicVoiceLabScoresSchema = z.object({
  grounding: scoreSchema,
  usefulness: scoreSchema,
  originality: scoreSchema,
  emotional_calibration: scoreSchema,
  conversational_aliveness: scoreSchema,
  restraint: scoreSchema,
}).strict();

export const publicVoiceLabCaseReviewSchema = z.object({
  caseId: z.string().regex(/^voice:[a-z0-9-]+$/u),
  outcome: z.enum(["approved", "revise", "rejected"]),
  scores: publicVoiceLabScoresSchema,
  notes: z.string().trim().max(2_000).optional(),
}).strict();

export const publicVoiceLabDecisionSchema = z.object({
  schemaVersion: z.literal("jolene.public-voice-lab-human-review.v1"),
  suiteId: z.literal("public-voice-lab:original-character-v1"),
  packetHash: z.string().regex(/^[a-f0-9]{64}$/),
  model: z.string().trim().min(1).max(120),
  reviewedAt: z.string().datetime({ offset: true }),
  reviewer: z.string().trim().min(1).max(120),
  overall: z.enum(["approved", "needs_changes", "rejected"]),
  dimensions: z.array(publicVoiceLabReviewDimensionSchema).length(6),
  reviews: z.array(publicVoiceLabCaseReviewSchema).length(30),
}).strict();

export type PublicVoiceLabDecision = z.infer<typeof publicVoiceLabDecisionSchema>;
