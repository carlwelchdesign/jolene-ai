import { z } from "zod";

import { containsLikelySecret } from "./public-portfolio-contract.js";

export const personalityResearchDecisionSchema = z.object({
  schemaVersion: z.literal("jolene.personality-research-decision.v1"),
  snapshotHash: z.string().regex(/^[a-f0-9]{64}$/),
  decision: z.enum(["approved", "changes_requested", "rejected"]),
  feedback: z.string().trim().max(4_000).refine(
    (value) => !containsLikelySecret(value),
    { message: "Personality research feedback cannot contain likely credentials or secrets." },
  ),
  reviewerId: z.string().trim().min(1).max(120),
  workspaceId: z.string().trim().min(1).max(120),
  reviewedAt: z.string().datetime({ offset: true }),
}).strict().superRefine((value, context) => {
  if (value.decision !== "approved" && value.feedback.length === 0) {
    context.addIssue({
      code: "custom",
      path: ["feedback"],
      message: "Changes requested and rejected decisions require feedback.",
    });
  }
});

export type PersonalityResearchDecision = z.infer<
  typeof personalityResearchDecisionSchema
>;
