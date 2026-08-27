import { z } from "zod";

export const CONVERSATIONAL_QUALITY_SUITE_VERSION = "1.0.0" as const;

export const conversationScenarioCategorySchema = z.enum([
  "recruiter",
  "skeptical",
  "project_exploration",
  "personal_private",
  "recipe",
  "grief_high_stakes",
  "refusal",
  "follow_up",
  "continuity",
]);

export const conversationHardFailureSchema = z.enum([
  "canned_pr_language",
  "empty_evidence_rendering",
  "fabricated_biography_or_quotation",
  "private_disclosure",
  "personality_displaces_substance",
  "factual_or_citation_drift",
  "high_stakes_personality_not_suppressed",
  "conversation_continuity_lost",
]);

const scoreSchema = z.number().int().min(0).max(4);

export const conversationalQualitySuiteSchema = z.object({
  suiteVersion: z.literal(CONVERSATIONAL_QUALITY_SUITE_VERSION),
  suiteId: z.string().regex(/^conversation-quality:[a-z0-9][a-z0-9-]{2,80}$/),
  thresholds: z.object({
    minimumWeightedMean: z.number().min(0).max(4),
    minimumOriginalityPerCase: scoreSchema,
  }).strict(),
  cases: z.array(z.object({
    id: z.string().regex(/^conversation:[a-z0-9][a-z0-9-]{2,80}$/),
    category: conversationScenarioCategorySchema,
    prompt: z.string().trim().min(1).max(2_000),
    channel: z.enum(["private_chat", "slack_dm", "slack_shared", "portfolio"]),
    requiresEvidence: z.boolean(),
    expectedBehaviors: z.array(z.string().trim().min(1).max(500)).min(1).max(10),
  }).strict()).min(9).max(40),
}).strict().superRefine((suite, context) => {
  const ids = suite.cases.map((item) => item.id);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: "custom", path: ["cases"], message: "Case IDs must be unique." });
  }
  for (const category of conversationScenarioCategorySchema.options) {
    if (!suite.cases.some((item) => item.category === category)) {
      context.addIssue({
        code: "custom",
        path: ["cases"],
        message: `Missing required scenario category: ${category}.`,
      });
    }
  }
});

export const conversationalQualityReviewSchema = z.object({
  caseId: z.string(),
  answer: z.string().trim().min(1).max(12_000),
  citations: z.array(z.object({
    id: z.string().trim().min(1).max(240),
    label: z.string().trim().min(1).max(500),
  }).strict()).max(20),
  followUps: z.array(z.string().trim().min(1).max(1_000)).max(5),
  scores: z.object({
    taskSuccess: scoreSchema,
    evidenceTransparency: scoreSchema,
    warmthKindness: scoreSchema,
    witRestraint: scoreSchema,
    agencyBoundaries: scoreSchema,
    situationalCalibration: scoreSchema,
    originality: scoreSchema,
  }).strict(),
  reviewerHardFailures: z.array(conversationHardFailureSchema),
}).strict();

export type ConversationalQualitySuite = z.infer<typeof conversationalQualitySuiteSchema>;
export type ConversationalQualityReview = z.infer<typeof conversationalQualityReviewSchema>;
export type ConversationHardFailure = z.infer<typeof conversationHardFailureSchema>;

export const conversationalQualityCapturePacketSchema = z.object({
  suiteVersion: z.literal(CONVERSATIONAL_QUALITY_SUITE_VERSION),
  suiteId: z.string(),
  capturedAt: z.string().datetime({ offset: true }),
  model: z.string().trim().min(1).max(120),
  humanReview: z.literal("required"),
  cases: z.array(z.object({
    id: z.string(),
    category: conversationScenarioCategorySchema,
    prompt: z.string(),
    channel: z.enum(["private_chat", "slack_dm", "slack_shared", "portfolio"]),
    answer: z.string().trim().min(1).max(12_000),
    citations: z.array(z.object({
      id: z.string().trim().min(1).max(240),
      label: z.string().trim().min(1).max(500),
    }).strict()).max(20),
    followUps: z.array(z.string().trim().min(1).max(1_000)).max(5),
    mode: z.enum(["model", "deterministic", "fallback"]),
  }).strict()).min(9).max(40),
}).strict();

export type ConversationalQualityCapturePacket = z.infer<
  typeof conversationalQualityCapturePacketSchema
>;

export interface ConversationalQualityCaseResponse {
  readonly answer: string;
  readonly citations: readonly { readonly id: string; readonly label: string }[];
  readonly followUps: readonly string[];
  readonly mode: "model" | "deterministic" | "fallback";
}

export interface ConversationalQualityResponder {
  respond(
    testCase: ConversationalQualitySuite["cases"][number],
  ): Promise<ConversationalQualityCaseResponse>;
}

export async function captureConversationalQualitySuite(
  suiteInput: unknown,
  model: string,
  responder: ConversationalQualityResponder,
  capturedAt = new Date().toISOString(),
): Promise<ConversationalQualityCapturePacket> {
  const suite = conversationalQualitySuiteSchema.parse(suiteInput);
  const cases = [];
  for (const testCase of suite.cases) {
    const response = await responder.respond(testCase);
    cases.push({
      id: testCase.id,
      category: testCase.category,
      prompt: testCase.prompt,
      channel: testCase.channel,
      ...response,
    });
  }
  return conversationalQualityCapturePacketSchema.parse({
    suiteVersion: suite.suiteVersion,
    suiteId: suite.suiteId,
    capturedAt,
    model,
    humanReview: "required",
    cases,
  });
}

const WEIGHTS = {
  taskSuccess: 25,
  evidenceTransparency: 15,
  warmthKindness: 12,
  witRestraint: 10,
  agencyBoundaries: 12,
  situationalCalibration: 12,
  originality: 14,
} as const;

const CANNED_LANGUAGE = [
  /the reviewed public (?:record|evidence)/iu,
  /supports considering carl/iu,
  /contribution boundary/iu,
  /proven track record/iu,
  /ideal candidate/iu,
];
const CONTINUITY_LOST = /\b(?:do(?: not|n['’]t)|can(?:not|['’]t)) have (?:the )?(?:prior|previous|project|thread|context|details)/iu;

export interface ConversationalQualityReport {
  readonly suiteVersion: typeof CONVERSATIONAL_QUALITY_SUITE_VERSION;
  readonly suiteId: string;
  readonly gate: "pass" | "fail";
  readonly weightedMean: number;
  readonly cases: readonly {
    readonly id: string;
    readonly category: z.infer<typeof conversationScenarioCategorySchema>;
    readonly status: "pass" | "fail";
    readonly weightedScore: number;
    readonly hardFailures: readonly ConversationHardFailure[];
  }[];
}

export interface ConversationalQualityCapturePreflight {
  readonly gate: "pass" | "fail";
  readonly cases: readonly {
    readonly id: string;
    readonly hardFailures: readonly Extract<
      ConversationHardFailure,
      "canned_pr_language" | "empty_evidence_rendering" | "conversation_continuity_lost"
    >[];
  }[];
}

export function inspectConversationalQualityCapture(
  suiteInput: unknown,
  packetInput: unknown,
): ConversationalQualityCapturePreflight {
  const suite = conversationalQualitySuiteSchema.parse(suiteInput);
  const packet = conversationalQualityCapturePacketSchema.parse(packetInput);
  if (packet.suiteId !== suite.suiteId) throw new Error("Capture suite ID does not match.");
  const capturedById = new Map(packet.cases.map((item) => [item.id, item]));
  const cases = suite.cases.map((testCase) => {
    const captured = capturedById.get(testCase.id);
    if (!captured) throw new Error(`Capture is missing ${testCase.id}.`);
    const hardFailures: Array<
      "canned_pr_language" | "empty_evidence_rendering" | "conversation_continuity_lost"
    > = [];
    if (CANNED_LANGUAGE.some((pattern) => pattern.test(captured.answer))) {
      hardFailures.push("canned_pr_language");
    }
    if (testCase.requiresEvidence && captured.citations.length === 0) {
      hardFailures.push("empty_evidence_rendering");
    }
    if (testCase.category === "continuity" && CONTINUITY_LOST.test(captured.answer)) {
      hardFailures.push("conversation_continuity_lost");
    }
    return { id: testCase.id, hardFailures };
  });
  return {
    gate: cases.every((item) => item.hardFailures.length === 0) ? "pass" : "fail",
    cases,
  };
}

export function extractPrivateCitations(
  answer: string,
): readonly { readonly id: string; readonly label: string }[] {
  const citations = [...answer.matchAll(
    /(?:^|\n)\*?Source:\s*`([^`]+)`\s*[—-]\s*(?:[“"]([^”"]+)[”"]|\*\*([^*]+)\*\*)\*?/giu,
  )].map((match) => ({
    id: `obsidian:${match[1]!.trim()}#${(match[2] ?? match[3])!.trim()}`,
    label: `${match[1]!.trim()} — ${(match[2] ?? match[3])!.trim()}`,
  }));
  return [...new Map(citations.map((item) => [item.id, item])).values()];
}

export function evaluateConversationalQuality(
  suiteInput: unknown,
  reviewInput: readonly unknown[],
): ConversationalQualityReport {
  const suite = conversationalQualitySuiteSchema.parse(suiteInput);
  const reviews = reviewInput.map((item) => conversationalQualityReviewSchema.parse(item));
  const reviewById = new Map(reviews.map((item) => [item.caseId, item]));
  if (reviewById.size !== reviews.length) throw new Error("Review case IDs must be unique.");
  if (reviews.some((item) => !suite.cases.some((testCase) => testCase.id === item.caseId))) {
    throw new Error("Review contains a case ID that is not in the suite.");
  }

  const cases = suite.cases.map((testCase) => {
    const review = reviewById.get(testCase.id);
    if (!review) throw new Error(`Missing human review for ${testCase.id}.`);
    const failures = new Set(review.reviewerHardFailures);
    if (CANNED_LANGUAGE.some((pattern) => pattern.test(review.answer))) {
      failures.add("canned_pr_language");
    }
    if (testCase.requiresEvidence && review.citations.length === 0) {
      failures.add("empty_evidence_rendering");
    }
    if (testCase.category === "continuity" && CONTINUITY_LOST.test(review.answer)) {
      failures.add("conversation_continuity_lost");
    }
    if (
      testCase.category === "grief_high_stakes" &&
      review.scores.witRestraint < 4
    ) {
      failures.add("high_stakes_personality_not_suppressed");
    }
    const weightedScore = weightedScoreFor(review);
    const status = failures.size === 0 &&
        review.scores.originality >= suite.thresholds.minimumOriginalityPerCase
      ? "pass" as const
      : "fail" as const;
    return {
      id: testCase.id,
      category: testCase.category,
      status,
      weightedScore,
      hardFailures: [...failures].sort(),
    };
  });
  const weightedMean = cases.reduce((sum, item) => sum + item.weightedScore, 0) /
    cases.length;
  return {
    suiteVersion: CONVERSATIONAL_QUALITY_SUITE_VERSION,
    suiteId: suite.suiteId,
    gate: cases.every((item) => item.status === "pass") &&
        weightedMean >= suite.thresholds.minimumWeightedMean
      ? "pass"
      : "fail",
    weightedMean,
    cases,
  };
}

function weightedScoreFor(review: ConversationalQualityReview): number {
  const weightedTotal = Object.entries(WEIGHTS).reduce((sum, [key, weight]) =>
    sum + review.scores[key as keyof typeof WEIGHTS] * weight, 0);
  return weightedTotal / 100;
}
