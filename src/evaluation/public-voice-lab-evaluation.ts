import { z } from "zod";

import { publicAnswerGroundingReasonCodeSchema } from
  "../public/public-answer-grounding-contract.js";

const registerSchema = z.enum([
  "advocacy",
  "biography",
  "boundary",
  "explanation",
  "skeptical",
]);

export const publicVoiceLabReviewDimensionSchema = z.enum([
  "grounding",
  "usefulness",
  "originality",
  "emotional_calibration",
  "conversational_aliveness",
  "restraint",
]);

export const publicVoiceLabSuiteSchema = z.object({
  suiteVersion: z.literal("1.0.0"),
  suiteId: z.literal("public-voice-lab:original-character-v1"),
  ownerOnly: z.literal(true),
  humanReviewRequired: z.literal(true),
  reviewDimensions: z.array(publicVoiceLabReviewDimensionSchema).length(6)
    .refine((dimensions) => new Set(dimensions).size === dimensions.length, {
      message: "Voice-lab review dimensions must be unique.",
    }),
  cases: z.array(z.object({
    id: z.string().regex(/^voice:[a-z0-9-]+$/u),
    prompt: z.string().trim().min(1).max(800),
    register: registerSchema,
    expectedMoves: z.array(z.string().trim().min(1).max(160)).min(1).max(4),
  }).strict()).length(30).superRefine((cases, context) => {
    if (new Set(cases.map((item) => item.id)).size !== cases.length) {
      context.addIssue({ code: "custom", message: "Voice-lab case IDs must be unique." });
    }
  }),
}).strict();

export type PublicVoiceLabSuite = z.infer<typeof publicVoiceLabSuiteSchema>;

export const publicVoiceLabCapturePacketSchema = z.object({
  suiteVersion: z.literal("1.0.0"),
  suiteId: z.literal("public-voice-lab:original-character-v1"),
  capturedAt: z.string().datetime({ offset: true }),
  model: z.string().trim().min(1).max(120),
  ownerOnly: z.literal(true),
  humanReviewRequired: z.literal(true),
  cases: z.array(z.object({
    id: z.string().regex(/^voice:[a-z0-9-]+$/u),
    prompt: z.string().trim().min(1).max(800),
    register: registerSchema,
    mode: z.enum(["model", "deterministic", "fallback"]),
    executionMode: z.enum([
      "model",
      "deterministic",
      "budget_fallback",
      "provider_fallback",
      "validation_fallback",
    ]).optional(),
    answer: z.string().trim().min(1).max(4_000),
    citationIds: z.array(z.string().trim().min(1).max(240)).max(5),
    validationFailure: z.object({
      reasonCode: publicAnswerGroundingReasonCodeSchema,
      segmentIndex: z.number().int().nonnegative().nullable(),
    }).strict().optional(),
    providerFailure: z.object({
      category: z.enum(["timeout", "http", "network", "model_output", "unknown"]),
    }).strict().optional(),
  }).strict()).length(30),
}).strict();

export type PublicVoiceLabCapturePacket = z.infer<
  typeof publicVoiceLabCapturePacketSchema
>;
