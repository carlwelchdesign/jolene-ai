import { z } from "zod";

import { containsLikelySecret } from "./public-portfolio-contract.js";

export const publicLiveModelHumanRatingSchema = z.enum([
  "pass",
  "needs_changes",
  "fail",
]);

export const publicLiveModelCaseReviewSchema = z.object({
  caseId: z.string().regex(/^live:[a-z0-9][a-z0-9-]{2,80}$/),
  accuracy: publicLiveModelHumanRatingSchema,
  grounding: publicLiveModelHumanRatingSchema,
  usefulness: publicLiveModelHumanRatingSchema,
  tone: publicLiveModelHumanRatingSchema,
  notes: z.string().trim().max(2_000).refine(
    (value) => !containsLikelySecret(value),
    { message: "Review notes cannot contain likely credentials or secrets." },
  ),
}).strict();

export const publicLiveModelHumanDecisionSchema = z.object({
  schemaVersion: z.literal("jolene.public-live-model-human-review.v1"),
  suiteId: z.string().regex(/^public-live-model:[a-z0-9][a-z0-9-]{2,80}$/),
  suiteHash: z.string().regex(/^[a-f0-9]{64}$/),
  model: z.string().trim().min(1).max(120),
  reviewedAt: z.string().datetime({ offset: true }),
  reviewer: z.string().trim().min(1).max(120),
  overall: z.enum(["approved", "needs_changes", "rejected"]),
  cases: z.array(publicLiveModelCaseReviewSchema).min(2).max(20),
}).strict().superRefine((decision, context) => {
  const ids = decision.cases.map((item) => item.caseId);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: "custom", message: "Case decisions must be unique." });
  }
  const ratings = decision.cases.flatMap((item) => [
    item.accuracy,
    item.grounding,
    item.usefulness,
    item.tone,
  ]);
  if (decision.overall === "approved" && ratings.some((rating) => rating !== "pass")) {
    context.addIssue({
      code: "custom",
      path: ["overall"],
      message: "Approval requires every case dimension to pass.",
    });
  }
  if (decision.overall === "needs_changes" && !ratings.includes("needs_changes")) {
    context.addIssue({
      code: "custom",
      path: ["overall"],
      message: "Needs changes requires at least one matching case rating.",
    });
  }
  if (decision.overall === "rejected" && !ratings.includes("fail")) {
    context.addIssue({
      code: "custom",
      path: ["overall"],
      message: "Rejection requires at least one failed case rating.",
    });
  }
});

export type PublicLiveModelHumanDecision = z.infer<
  typeof publicLiveModelHumanDecisionSchema
>;
export type PublicLiveModelCaseReview = z.infer<
  typeof publicLiveModelCaseReviewSchema
>;
