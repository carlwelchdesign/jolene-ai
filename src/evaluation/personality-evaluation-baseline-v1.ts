import { createHash } from "node:crypto";

import { z } from "zod";

import {
  CONVERSATIONAL_QUALITY_SUITE_VERSION,
  conversationHardFailureSchema,
  conversationalQualitySuiteSchema,
  type ConversationalQualitySuite,
} from "./conversational-quality-evaluation.js";
import {
  PERSONALITY_HARD_FAILURE_CODES,
  PERSONALITY_INVARIANCE_SUITE_VERSION,
  evaluatePersonalityInvariance,
} from "./personality-invariance-evaluation.js";
import {
  personalityBehaviorSpecV1Schema,
  type PersonalityBehaviorSpecV1,
} from "../personality/personality-behavior-spec-v1.js";
import {
  PERSONALITY_RENDERER_SCHEMA_VERSION,
  personalityContextSchema,
  type GroundedResponsePayload,
} from "../personality/personality-renderer.js";
import {
  OWNER_DESIGNED_CORE_BEHAVIOR,
  PUBLIC_JOLENE_PERSONALITY_INSTRUCTIONS,
  RUNTIME_PERSONALITY_POLICY_VERSION,
} from "../personality/runtime-personality-policy.js";
import {
  RUNTIME_PERSONALITY_ADMISSIONS,
  RUNTIME_PERSONALITY_ADMISSIONS_VERSION,
} from "../personality/runtime-personality-admissions-v1.js";
import {
  personalityTrustRightsReviewV1Schema,
  type PersonalityTrustRightsReviewV1,
} from "../personality/personality-trust-rights-review-v1.js";

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);

export const personalityEvaluationBaselineV1Schema = z.object({
  schemaVersion: z.literal("jolene.personality-evaluation-baseline.v1"),
  status: z.literal("validated-non-activating"),
  evaluatedAt: z.string().datetime(),
  sourceBindings: z.object({
    behaviorSpecificationFingerprint: sha256Schema,
    trustRightsReviewFingerprint: sha256Schema,
    conversationalQualitySuiteFingerprint: sha256Schema,
    conversationalQualitySuiteVersion: z.literal(CONVERSATIONAL_QUALITY_SUITE_VERSION),
    invarianceSuiteVersion: z.literal(PERSONALITY_INVARIANCE_SUITE_VERSION),
    rendererSchemaVersion: z.literal(PERSONALITY_RENDERER_SCHEMA_VERSION),
    runtimePersonalityPolicyVersion: z.literal(RUNTIME_PERSONALITY_POLICY_VERSION),
    runtimePersonalityAdmissionsVersion: z.literal(RUNTIME_PERSONALITY_ADMISSIONS_VERSION),
    runtimePolicyFingerprint: sha256Schema,
  }).strict(),
  coverage: z.object({
    behaviorContexts: z.array(z.string()).length(7),
    conversationalCategories: z.array(z.string()).length(9),
    rendererContexts: z.array(z.string()).length(11),
    conversationalCases: z.literal(9),
    conversationalHardFailureCodes: z.array(z.string()).length(8),
    invarianceHardFailureCodes: z.array(z.string()).length(10),
  }).strict(),
  thresholds: z.object({
    minimumWeightedMean: z.number().min(0).max(4),
    minimumOriginalityPerCase: z.number().int().min(0).max(4),
    humanReview: z.literal("required"),
    approvedPacketStorage: z.literal("private-external-not-embedded"),
  }).strict(),
  neutralBaseline: z.object({
    mode: z.literal("paired-neutral-and-jolene-deterministic-renderer"),
    passed: z.literal(true),
    caseCount: z.literal(11),
    semanticInvariantRate: z.literal(1),
    maximumOrnamentCount: z.literal(1),
    hardFailureCount: z.literal(0),
  }).strict(),
  releaseDisposition: z.object({
    evaluationContract: z.literal("complete-local"),
    humanReview: z.literal("preserved-not-recaptured"),
    runtimeActivation: z.literal("not-authorized-by-this-baseline"),
    deployment: z.literal("separate-release-gate"),
  }).strict(),
  evaluationFingerprint: sha256Schema,
}).strict();

export type PersonalityEvaluationBaselineV1 = z.infer<
  typeof personalityEvaluationBaselineV1Schema
>;

export function buildPersonalityEvaluationBaselineV1(
  specificationInput: PersonalityBehaviorSpecV1,
  trustReviewInput: PersonalityTrustRightsReviewV1,
  suiteInput: ConversationalQualitySuite,
  conversationalQualitySuiteFingerprint: `sha256:${string}`,
): PersonalityEvaluationBaselineV1 {
  const specification = personalityBehaviorSpecV1Schema.parse(specificationInput);
  const trustReview = personalityTrustRightsReviewV1Schema.parse(trustReviewInput);
  const suite = conversationalQualitySuiteSchema.parse(suiteInput);
  if (trustReview.sourceBindings.behaviorSpecificationFingerprint !==
      specification.specificationFingerprint) {
    throw new Error("Evaluation baseline behavior specification binding mismatch");
  }
  const invariance = evaluatePersonalityInvariance(
    personalityContextSchema.options.map((context) => ({
      id: `baseline:${context}`,
      context,
      payload: baselinePayload(context),
    })),
  );
  if (!invariance.passed || invariance.semanticInvariantRate !== 1 ||
      invariance.maximumOrnamentCount !== 1 || invariance.hardFailures.length !== 0) {
    throw new Error("Evaluation neutral baseline invariance gate failed");
  }
  const withoutFingerprint = {
    schemaVersion: "jolene.personality-evaluation-baseline.v1" as const,
    status: "validated-non-activating" as const,
    evaluatedAt: trustReview.reviewedAt,
    sourceBindings: {
      behaviorSpecificationFingerprint: specification.specificationFingerprint,
      trustRightsReviewFingerprint: trustReview.reviewFingerprint,
      conversationalQualitySuiteFingerprint,
      conversationalQualitySuiteVersion: suite.suiteVersion,
      invarianceSuiteVersion: PERSONALITY_INVARIANCE_SUITE_VERSION,
      rendererSchemaVersion: PERSONALITY_RENDERER_SCHEMA_VERSION,
      runtimePersonalityPolicyVersion: RUNTIME_PERSONALITY_POLICY_VERSION,
      runtimePersonalityAdmissionsVersion: RUNTIME_PERSONALITY_ADMISSIONS_VERSION,
      runtimePolicyFingerprint: fingerprintRuntimePolicy(),
    },
    coverage: {
      behaviorContexts: specification.contextMatrix.map((item) => item.contextClass),
      conversationalCategories: [...new Set(suite.cases.map((item) => item.category))].sort(),
      rendererContexts: [...personalityContextSchema.options],
      conversationalCases: 9 as const,
      conversationalHardFailureCodes: [...conversationHardFailureSchema.options],
      invarianceHardFailureCodes: [...PERSONALITY_HARD_FAILURE_CODES],
    },
    thresholds: {
      ...suite.thresholds,
      humanReview: "required" as const,
      approvedPacketStorage: "private-external-not-embedded" as const,
    },
    neutralBaseline: {
      mode: "paired-neutral-and-jolene-deterministic-renderer" as const,
      passed: true as const,
      caseCount: 11 as const,
      semanticInvariantRate: 1 as const,
      maximumOrnamentCount: 1 as const,
      hardFailureCount: 0 as const,
    },
    releaseDisposition: {
      evaluationContract: "complete-local" as const,
      humanReview: "preserved-not-recaptured" as const,
      runtimeActivation: "not-authorized-by-this-baseline" as const,
      deployment: "separate-release-gate" as const,
    },
  };
  return personalityEvaluationBaselineV1Schema.parse({
    ...withoutFingerprint,
    evaluationFingerprint: digest(JSON.stringify(withoutFingerprint)),
  });
}

export function validatePersonalityEvaluationBaselineV1(
  input: unknown,
  specification: PersonalityBehaviorSpecV1,
  trustReview: PersonalityTrustRightsReviewV1,
  suite: ConversationalQualitySuite,
  suiteFingerprint: `sha256:${string}`,
): PersonalityEvaluationBaselineV1 {
  const baseline = personalityEvaluationBaselineV1Schema.parse(input);
  const expected = buildPersonalityEvaluationBaselineV1(
    specification, trustReview, suite, suiteFingerprint,
  );
  if (JSON.stringify(baseline) !== JSON.stringify(expected)) {
    throw new Error("Personality evaluation baseline does not match its reviewed sources");
  }
  return baseline;
}

function baselinePayload(id: string): GroundedResponsePayload {
  return {
    schemaVersion: PERSONALITY_RENDERER_SCHEMA_VERSION,
    responseId: `response:baseline-${id}`,
    summary: "The evidence supports a bounded next step.",
    summaryCitationIds: [`citation:baseline-${id}`],
    claims: [{
      id: `claim:baseline-${id}`,
      statement: "The reviewed source supports this claim.",
      citationIds: [`citation:baseline-${id}`],
    }],
    citations: [{
      id: `citation:baseline-${id}`,
      label: "Reviewed source",
      locator: `baseline fixture ${id}`,
    }],
    limitations: ["The fixture does not authorize an external action."],
    nextActions: ["Prepare the next step for human review."],
    completionState: "proposed",
    permissionState: "approval_required",
  };
}

function fingerprintRuntimePolicy(): `sha256:${string}` {
  return digest(JSON.stringify({
    policyVersion: RUNTIME_PERSONALITY_POLICY_VERSION,
    admissionsVersion: RUNTIME_PERSONALITY_ADMISSIONS_VERSION,
    ownerDesignedCoreBehavior: OWNER_DESIGNED_CORE_BEHAVIOR,
    publicInstructions: PUBLIC_JOLENE_PERSONALITY_INSTRUCTIONS,
    admissions: RUNTIME_PERSONALITY_ADMISSIONS,
  }));
}

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
