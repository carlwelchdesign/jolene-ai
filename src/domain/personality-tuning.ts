import { createHash } from "node:crypto";

import { z } from "zod";

import { containsLikelySecret } from "./public-portfolio-contract.js";

export const PERSONALITY_TUNING_CONTRACT_VERSION =
  "jolene.personality-tuning-contract.v1" as const;
export const PERSONALITY_TUNING_DECISION_VERSION =
  "jolene.personality-tuning-decision.v1" as const;

export const personalityTuningProfileSchema = z.object({
  witIntensity: z.number().int().min(0).max(3),
  termsOfEndearment: z.enum(["disabled", "private_opt_in"]),
  faithLanguage: z.enum(["absent", "user_led_only", "lightly_available"]),
  challengeStyle: z.enum([
    "direct_when_evidence_clear",
    "ask_permission_first",
  ]),
  privateResponseLength: z.enum(["concise", "adaptive", "detailed"]),
  slackResponseLength: z.enum(["concise", "adaptive"]),
  inspirationStrength: z.enum([
    "subtle",
    "noticeable",
    "theatrical_but_original",
  ]),
  vaultRetrievalPreference: z.enum([
    "explicit_allowlist",
    "ask_each_time",
  ]),
  clientAiDisclosure: z.enum([
    "task_packets_only",
    "selected_excerpts_with_exact_approval",
  ]),
}).strict();

export type PersonalityTuningProfile = z.infer<
  typeof personalityTuningProfileSchema
>;

export const RECOMMENDED_PERSONALITY_TUNING: PersonalityTuningProfile = {
  witIntensity: 1,
  termsOfEndearment: "disabled",
  faithLanguage: "user_led_only",
  challengeStyle: "direct_when_evidence_clear",
  privateResponseLength: "adaptive",
  slackResponseLength: "concise",
  inspirationStrength: "subtle",
  vaultRetrievalPreference: "explicit_allowlist",
  clientAiDisclosure: "task_packets_only",
};

export const PERSONALITY_TUNING_OPTIONS = {
  witIntensity: [0, 1, 2, 3],
  termsOfEndearment: ["disabled", "private_opt_in"],
  faithLanguage: ["absent", "user_led_only", "lightly_available"],
  challengeStyle: ["direct_when_evidence_clear", "ask_permission_first"],
  privateResponseLength: ["concise", "adaptive", "detailed"],
  slackResponseLength: ["concise", "adaptive"],
  inspirationStrength: ["subtle", "noticeable", "theatrical_but_original"],
  vaultRetrievalPreference: ["explicit_allowlist", "ask_each_time"],
  clientAiDisclosure: [
    "task_packets_only",
    "selected_excerpts_with_exact_approval",
  ],
} as const;

export const personalityTuningDecisionSchema = z.object({
  schemaVersion: z.literal(PERSONALITY_TUNING_DECISION_VERSION),
  snapshotHash: z.string().regex(/^[a-f0-9]{64}$/),
  tuningContractHash: z.string().regex(/^[a-f0-9]{64}$/),
  profile: personalityTuningProfileSchema,
  notes: z.string().trim().max(4_000).refine(
    (value) => !containsLikelySecret(value),
    { message: "Personality tuning notes cannot contain likely credentials or secrets." },
  ),
  reviewerId: z.string().trim().min(1).max(120),
  workspaceId: z.string().trim().min(1).max(120),
  reviewedAt: z.string().datetime({ offset: true }),
}).strict();

export type PersonalityTuningDecision = z.infer<
  typeof personalityTuningDecisionSchema
>;

export interface PersonalityTuningContract {
  readonly schemaVersion: typeof PERSONALITY_TUNING_CONTRACT_VERSION;
  readonly contractHash: string;
  readonly recommendedProfile: PersonalityTuningProfile;
  readonly options: typeof PERSONALITY_TUNING_OPTIONS;
  readonly activationEffect: "none";
}

export function personalityTuningContract(): PersonalityTuningContract {
  const content = {
    schemaVersion: PERSONALITY_TUNING_CONTRACT_VERSION,
    recommendedProfile: RECOMMENDED_PERSONALITY_TUNING,
    options: PERSONALITY_TUNING_OPTIONS,
    activationEffect: "none" as const,
  };
  return {
    ...content,
    contractHash: createHash("sha256")
      .update(stableStringify(content))
      .digest("hex"),
  };
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${stableStringify(record[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}
