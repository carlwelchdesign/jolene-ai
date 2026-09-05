import { z } from "zod";

export const PUBLIC_VOICE_AUDITION_VERSION = "jolene.public-voice-audition.v1" as const;

export const publicVoiceAuditionCaseSchema = z.object({
  id: z.enum([
    "audition:advocacy-hire",
    "audition:advocacy-creative",
    "audition:biography-career",
    "audition:explanation-rag",
    "audition:explanation-systems",
    "audition:skeptical-fit",
  ]),
  prompt: z.string().trim().min(1).max(800),
  register: z.enum(["advocacy", "biography", "explanation", "skeptical"]),
}).strict();

export const PUBLIC_VOICE_AUDITION_CASES = [
  { id: "audition:advocacy-hire", prompt: "Why should I hire Carl?", register: "advocacy" },
  { id: "audition:advocacy-creative", prompt: "Why does Carl's creative background matter?", register: "advocacy" },
  { id: "audition:biography-career", prompt: "What is the through-line across Carl's career?", register: "biography" },
  { id: "audition:explanation-rag", prompt: "How does Carl use RAG?", register: "explanation" },
  { id: "audition:explanation-systems", prompt: "How does Carl connect product judgment with engineering?", register: "explanation" },
  { id: "audition:skeptical-fit", prompt: "Why shouldn't I hire Carl?", register: "skeptical" },
] as const satisfies readonly z.infer<typeof publicVoiceAuditionCaseSchema>[];

export const publicVoiceAuditionCandidateSchema = z.object({
  id: z.enum(["a", "b", "c"]),
  mechanic: z.enum(["playful_comparison", "literal_flip", "small_story_turn"]),
  opening: z.string().trim().min(8).max(240),
  answer: z.string().trim().min(80).max(700),
  closing: z.string().trim().min(8).max(240),
}).strict();

export const publicVoiceAuditionCaseResultSchema = z.object({
  ...publicVoiceAuditionCaseSchema.shape,
  candidates: z.array(publicVoiceAuditionCandidateSchema).length(3)
    .refine((items) => new Set(items.map((item) => item.id)).size === 3, {
      message: "Audition candidate IDs must be unique.",
    }).refine((items) => new Set(items.map((item) => item.mechanic)).size === 3, {
      message: "Audition mechanics must be unique.",
    }),
}).strict();

export const publicVoiceAuditionPacketSchema = z.object({
  version: z.literal(PUBLIC_VOICE_AUDITION_VERSION),
  capturedAt: z.string().datetime({ offset: true }),
  model: z.string().trim().min(1).max(120),
  ownerOnly: z.literal(true),
  cases: z.array(publicVoiceAuditionCaseResultSchema).length(6),
}).strict();

export type PublicVoiceAuditionPacket = z.infer<typeof publicVoiceAuditionPacketSchema>;
