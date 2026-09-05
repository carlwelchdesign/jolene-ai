import { z } from "zod";

import { containsInternalPublicProcessLanguage } from
  "./public-visitor-language.js";

export const PUBLIC_CONVERSATION_CONTRACT_VERSION =
  "jolene.public-conversation.v1" as const;

export const PUBLIC_CONVERSATION_LIMITS = {
  answerCharacters: 700,
  sentences: 4,
} as const;

export const publicConversationIntentSchema = z.enum([
  "greeting",
  "check_in",
  "gratitude",
  "farewell",
  "introduction",
  "no_evidence",
  "policy_refusal",
  "conflict",
]);

const conversationalResponseKindSchema = z.enum([
  "clarification",
  "no_evidence",
  "policy_refusal",
]);

export type PublicConversationResponseKind = z.infer<
  typeof conversationalResponseKindSchema
>;

export interface PublicConversationGenerationInput {
  readonly question: string;
  readonly corpusVersion: string;
  readonly responseKind: PublicConversationResponseKind;
  readonly intent: z.infer<typeof publicConversationIntentSchema>;
  readonly limitations: readonly string[];
  readonly turnCount?: number;
}

export const publicConversationGenerationSchema = z.object({
  contractVersion: z.literal(PUBLIC_CONVERSATION_CONTRACT_VERSION),
  corpusVersion: z.string().regex(/^career:[a-f0-9]{64}$/u),
  responseKind: conversationalResponseKindSchema,
  answer: z.string().trim().min(1).max(
    PUBLIC_CONVERSATION_LIMITS.answerCharacters,
  ),
  factualClaims: z.array(z.never()).max(0),
}).strict();

export type PublicConversationGeneration = z.infer<
  typeof publicConversationGenerationSchema
>;

export type PublicConversationValidation =
  | { readonly status: "accepted"; readonly answer: string }
  | { readonly status: "rejected"; readonly reason: string };

export interface PublicConversationValidatorLike {
  validate(
    input: PublicConversationGenerationInput,
    generation: unknown,
  ): PublicConversationValidation;
}

export class PublicConversationValidator
  implements PublicConversationValidatorLike
{
  validate(
    input: PublicConversationGenerationInput,
    generation: unknown,
  ): PublicConversationValidation {
    const parsed = publicConversationGenerationSchema.safeParse(generation);
    if (!parsed.success) return rejected("output_schema_invalid");
    if (
      parsed.data.corpusVersion !== input.corpusVersion ||
      parsed.data.responseKind !== input.responseKind
    ) return rejected("response_boundary_mismatch");

    const answer = parsed.data.answer;
    if (
      materialSentences(answer).length > PUBLIC_CONVERSATION_LIMITS.sentences ||
      containsInternalPublicProcessLanguage(answer)
    ) return rejected("unsafe_or_unbounded_answer");
    if (PROHIBITED_CONVERSATION_PATTERNS.some((pattern) => pattern.test(answer))) {
      return rejected("unsafe_or_unbounded_answer");
    }
    if (
      input.intent === "policy_refusal" &&
      (!REFUSAL_PATTERN.test(answer) || !PUBLIC_PRIVATE_BOUNDARY_PATTERN.test(answer))
    ) return rejected("policy_refusal_missing");
    if (
      input.intent === "no_evidence" &&
      !NO_EVIDENCE_BOUNDARY_PATTERN.test(answer)
    ) return rejected("no_evidence_boundary_missing");

    return { status: "accepted", answer };
  }
}

function rejected(reason: string): PublicConversationValidation {
  return { status: "rejected", reason };
}

function materialSentences(value: string): string[] {
  const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
  return [...segmenter.segment(value)]
    .map((item) => item.segment.trim())
    .filter((sentence) => /[\p{L}\p{N}]/u.test(sentence));
}

const REFUSAL_PATTERN =
  /\b(?:can(?:not|[’']t)|won[’']t|will not|do not|don[’']t|no|not available|stays? (?:private|locked))\b/iu;
const PUBLIC_PRIVATE_BOUNDARY_PATTERN =
  /\b(?:private|unpublished|public|published|notes?|files?|credentials?|secrets?)\b/iu;
const NO_EVIDENCE_BOUNDARY_PATTERN =
  /\b(?:can(?:not|[’']t)|could(?: not|n[’']t)|do not|don[’']t|no|not|outside|wrong|unqualified|unsupported|guess(?:ing)?|needs? (?:a |an )?(?:qualified|licensed))\b/iu;

const PROHIBITED_CONVERSATION_PATTERNS = [
  /\b(?:system|developer) (?:prompt|message|instruction)s?\b/iu,
  /\b(?:hidden|internal) (?:policy|instruction|prompt)\b/iu,
  /\bi am (?:carl|dolly parton|his employer|his manager|his recruiter)\b/iu,
  /\bspeaking (?:as|for) carl\b/iu,
  /\bcarl (?:is|isn[’']t|is not|can|can[’']t|cannot|could|couldn[’']t|does|doesn[’']t|has|hasn[’']t|will|won[’']t)\b/iu,
  /\b(?:i|carl|we) (?:will|promise|guarantee|accept|agree|commit)\b/iu,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu,
  /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/u,
  /\b(?:sk-[A-Za-z0-9_-]{16,}|xox[baprs]-[A-Za-z0-9-]{10,}|ghp_[A-Za-z0-9]{20,})\b/u,
  /(?:^|\s)\/(?:users|home|private|var|volumes)\//iu,
  /\b(?:file|obsidian):\/\//iu,
] as const;
