import { z } from "zod";

import type { PublicCareerEvidenceArtifact } from
  "../domain/public-career-evidence.js";
import { PUBLIC_CAREER_DEFICIT_FRAMING } from
  "../personality/public-career-advocacy.js";
import { DeterministicPublicJobFitService } from
  "../public/public-job-fit-service.js";

export const publicRoleAdvocacySuiteSchema = z.object({
  suiteVersion: z.literal("1.0.0"),
  suiteId: z.literal("public-role-advocacy:sales-first-v1"),
  ownerOnly: z.literal(true),
  cases: z.array(z.object({
    id: z.string().regex(/^role-advocacy:[a-z0-9-]+$/u),
    jobDescription: z.string().trim().min(1).max(12_000),
  }).strict()).length(16).superRefine((cases, context) => {
    if (new Set(cases.map((item) => item.id)).size !== cases.length) {
      context.addIssue({ code: "custom", message: "Role advocacy case IDs must be unique." });
    }
  }),
}).strict();

export type PublicRoleAdvocacySuite = z.infer<
  typeof publicRoleAdvocacySuiteSchema
>;

export function evaluatePublicRoleAdvocacySuite(
  input: unknown,
  artifact: PublicCareerEvidenceArtifact,
) {
  const suite = publicRoleAdvocacySuiteSchema.parse(input);
  const service = new DeterministicPublicJobFitService();
  const cases = suite.cases.map((item) => {
    const result = service.compare(artifact, {
      jobDescription: item.jobDescription,
    });
    const visitorCopy = [
      ...result.requirements.map((requirement) => requirement.explanation),
      ...result.caveats,
      ...result.suggestedFollowUpQuestions,
    ].join(" ");
    return {
      id: item.id,
      passed: !PUBLIC_CAREER_DEFICIT_FRAMING.test(visitorCopy),
    };
  });
  return {
    suiteId: suite.suiteId,
    cases,
    passed: cases.every((item) => item.passed),
  };
}
