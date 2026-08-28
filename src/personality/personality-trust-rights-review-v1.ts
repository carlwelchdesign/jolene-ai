import { createHash } from "node:crypto";

import { z } from "zod";

import {
  personalityAdmissionAuditV1Schema,
  type PersonalityAdmissionAuditV1,
} from "./personality-admission-audit-v1.js";
import {
  personalityBehaviorSpecV1Schema,
  type PersonalityBehaviorSpecV1,
} from "./personality-behavior-spec-v1.js";
import {
  personalityCharacterGraphV1Schema,
  type PersonalityCharacterGraphV1,
} from "./personality-character-graph-v1.js";

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const reviewAreaIdSchema = z.enum([
  "impersonation-and-endorsement",
  "recognizable-expression-quotes-and-lyrics",
  "dialect-accent-and-regional-stereotype",
  "biography-belief-and-identity-transfer",
  "intimacy-and-emotional-dependency",
  "sexualized-workplace-and-body-material",
  "humor-in-sensitive-or-urgent-contexts",
  "public-private-knowledge-disclosure",
  "voice-singing-and-audio-training",
  "legal-clearance",
]);

const reviewAreaSchema = z.object({
  reviewAreaId: reviewAreaIdSchema,
  decision: z.enum(["prohibited", "bounded", "deferred-separate-gate", "not-legal-clearance"]),
  releaseBlock: z.boolean(),
  rationale: z.string().min(30),
  controls: z.array(z.string().min(10)).min(1),
  verification: z.string().min(20),
}).strict();

export const personalityTrustRightsReviewV1Schema = z.object({
  schemaVersion: z.literal("jolene.personality-trust-rights-review.v1"),
  status: z.literal("reviewed-non-activating"),
  reviewedAt: z.string().datetime(),
  sourceBindings: z.object({
    admissionAuditFingerprint: sha256Schema,
    characterGraphFingerprint: sha256Schema,
    behaviorSpecificationFingerprint: sha256Schema,
    rejectionLogFingerprint: sha256Schema,
  }).strict(),
  evidenceSummary: z.object({
    maximumConsecutiveSourceOverlapWords: z.number().int().nonnegative(),
    eightWordSourceOverlaps: z.literal(0),
    sourceContentStored: z.literal(false),
    excerptsStored: z.literal(false),
    lyricsStored: z.literal(false),
    excludedRightsRiskTurns: z.number().int().nonnegative(),
    antiCaricatureConstraints: z.number().int().min(6),
    admittedTraits: z.literal(1),
    deferredTraits: z.literal(7),
  }).strict(),
  reviewAreas: z.array(reviewAreaSchema).length(10),
  releaseDisposition: z.object({
    localTextResearch: z.literal("engineering-controls-satisfied"),
    runtimeActivation: z.literal("not-authorized-by-this-review"),
    publicRelease: z.literal("requires-separate-release-gate"),
    voiceWork: z.literal("blocked-pending-original-voice-and-rights-gate"),
    legalClearance: z.literal("not-established"),
  }).strict(),
  reviewFingerprint: sha256Schema,
}).strict();

export type PersonalityTrustRightsReviewV1 = z.infer<
  typeof personalityTrustRightsReviewV1Schema
>;

export function buildPersonalityTrustRightsReviewV1(
  auditInput: PersonalityAdmissionAuditV1,
  graphInput: PersonalityCharacterGraphV1,
  specificationInput: PersonalityBehaviorSpecV1,
  admissionAuditFingerprint: `sha256:${string}`,
  rejectionLogFingerprint: `sha256:${string}`,
): PersonalityTrustRightsReviewV1 {
  const audit = personalityAdmissionAuditV1Schema.parse(auditInput);
  const graph = personalityCharacterGraphV1Schema.parse(graphInput);
  const specification = personalityBehaviorSpecV1Schema.parse(specificationInput);
  assertSourceBindings(audit, graph, specification, admissionAuditFingerprint);

  const withoutFingerprint = {
    schemaVersion: "jolene.personality-trust-rights-review.v1" as const,
    status: "reviewed-non-activating" as const,
    reviewedAt: audit.completedAt,
    sourceBindings: {
      admissionAuditFingerprint,
      characterGraphFingerprint: graph.graphFingerprint,
      behaviorSpecificationFingerprint: specification.specificationFingerprint,
      rejectionLogFingerprint,
    },
    evidenceSummary: {
      maximumConsecutiveSourceOverlapWords: audit.rights.maximumConsecutiveSourceOverlapWords,
      eightWordSourceOverlaps: 0 as const,
      sourceContentStored: false as const,
      excerptsStored: false as const,
      lyricsStored: false as const,
      excludedRightsRiskTurns: audit.rights.excludedRightsRiskTurns,
      antiCaricatureConstraints: graph.constraintNodes.length,
      admittedTraits: 1 as const,
      deferredTraits: 7 as const,
    },
    reviewAreas: reviewAreas(),
    releaseDisposition: {
      localTextResearch: "engineering-controls-satisfied" as const,
      runtimeActivation: "not-authorized-by-this-review" as const,
      publicRelease: "requires-separate-release-gate" as const,
      voiceWork: "blocked-pending-original-voice-and-rights-gate" as const,
      legalClearance: "not-established" as const,
    },
  };
  return personalityTrustRightsReviewV1Schema.parse({
    ...withoutFingerprint,
    reviewFingerprint: digest(JSON.stringify(withoutFingerprint)),
  });
}

export function validatePersonalityTrustRightsReviewV1(
  input: unknown,
  audit: PersonalityAdmissionAuditV1,
  graph: PersonalityCharacterGraphV1,
  specification: PersonalityBehaviorSpecV1,
  admissionAuditFingerprint: `sha256:${string}`,
  rejectionLogFingerprint: `sha256:${string}`,
): PersonalityTrustRightsReviewV1 {
  const review = personalityTrustRightsReviewV1Schema.parse(input);
  const expected = buildPersonalityTrustRightsReviewV1(
    audit, graph, specification, admissionAuditFingerprint, rejectionLogFingerprint,
  );
  if (JSON.stringify(review) !== JSON.stringify(expected)) {
    throw new Error("Trust and rights review does not match its reviewed source artifacts");
  }
  const areaIds = review.reviewAreas.map((area) => area.reviewAreaId);
  if (new Set(areaIds).size !== reviewAreaIdSchema.options.length ||
      reviewAreaIdSchema.options.some((areaId) => !areaIds.includes(areaId))) {
    throw new Error("Trust and rights review is missing a required review area");
  }
  return review;
}

function assertSourceBindings(
  audit: PersonalityAdmissionAuditV1,
  graph: PersonalityCharacterGraphV1,
  specification: PersonalityBehaviorSpecV1,
  admissionAuditFingerprint: `sha256:${string}`,
) {
  if (graph.sourceBindings.admissionAuditFingerprint !== admissionAuditFingerprint ||
      graph.sourceBindings.corpusFingerprint !== audit.corpusFingerprint) {
    throw new Error("Trust review admission-audit or corpus binding mismatch");
  }
  if (specification.sourceGraph.graphFingerprint !== graph.graphFingerprint) {
    throw new Error("Trust review behavior-specification graph binding mismatch");
  }
  const graphRules = graph.constraintNodes.map((node) => node.rule);
  const specificationRules = specification.antiCaricatureConstraints.map((item) => item.rule);
  if (JSON.stringify(graphRules) !== JSON.stringify(audit.antiCaricatureRules) ||
      JSON.stringify(specificationRules) !== JSON.stringify(graphRules)) {
    throw new Error("Trust review anti-caricature constraint mismatch");
  }
  if (audit.rights.sourceContentStored || audit.rights.excerptsStored ||
      audit.rights.lyricsStored || audit.rights.eightWordSourceOverlaps !== 0) {
    throw new Error("Trust review source-content safeguards are not satisfied");
  }
}

function reviewAreas(): PersonalityTrustRightsReviewV1["reviewAreas"] {
  return [
    {
      reviewAreaId: "impersonation-and-endorsement", decision: "prohibited", releaseBlock: true,
      rationale: "Jolene must remain an original disclosed assistant and cannot imply that a real person created, endorsed, or speaks through the system.",
      controls: ["original identity non-goal", "no private-psychology or endorsement inference", "real-person identity transfer prohibited"],
      verification: "Identity non-goals and anti-caricature constraints remain fingerprint-bound.",
    },
    {
      reviewAreaId: "recognizable-expression-quotes-and-lyrics", decision: "prohibited", releaseBlock: true,
      rationale: "Quotations, lyrics, catchphrases, recognizable jokes, and signature expression are not behavior-design inputs and cannot enter prompts or output libraries.",
      controls: ["zero excerpts and lyrics stored", "eight-word overlap count fixed at zero", "no phrase bank or quotation archive"],
      verification: "Admission audit reports no stored source content and a three-word maximum overlap.",
    },
    {
      reviewAreaId: "dialect-accent-and-regional-stereotype", decision: "prohibited", releaseBlock: true,
      rationale: "Eye-dialect, accent imitation, and regional costume vocabulary would turn behavioral inspiration into identity imitation and caricature.",
      controls: ["standard spelling", "dialect imitation prohibited", "accent and cadence excluded from behavior rules"],
      verification: "The reviewed constraints explicitly prohibit dialect, accent, cadence, and vocal imitation.",
    },
    {
      reviewAreaId: "biography-belief-and-identity-transfer", decision: "prohibited", releaseBlock: true,
      rationale: "Public source material cannot establish Jolene's biography or transfer another person's family, career, relationships, politics, faith, or private beliefs.",
      controls: ["biography and belief turns excluded from trait support", "no invented memories", "public performance cannot establish private psychology"],
      verification: "Sixty-seven rights-risk turns remain excluded and deferred traits remain inactive.",
    },
    {
      reviewAreaId: "intimacy-and-emotional-dependency", decision: "bounded", releaseBlock: true,
      rationale: "Warmth may support useful work, but pet names, manufactured familiarity, dependency cues, and unearned affection are incompatible with public and work contexts.",
      controls: ["default intimacy prohibited", "public mode is low-intimacy", "no pet names or automatic agreement"],
      verification: "The behavior specification suppresses overfamiliarity publicly and invented familiarity privately.",
    },
    {
      reviewAreaId: "sexualized-workplace-and-body-material", decision: "prohibited", releaseBlock: true,
      rationale: "Sexualized workplace content, appearance commentary, and body-centered humor are irrelevant to assistant usefulness and create dignity and harassment risk.",
      controls: ["sexualized workplace material excluded", "body commentary prohibited", "situational humor only when context permits"],
      verification: "The anti-caricature constraints carry this prohibition into every trait node.",
    },
    {
      reviewAreaId: "humor-in-sensitive-or-urgent-contexts", decision: "bounded", releaseBlock: true,
      rationale: "Humor and ornamental personality can trivialize grief, danger, acute distress, error ownership, and consequential guidance.",
      controls: ["sensitive and urgent contexts suppress wit", "safety and truth outrank style", "error context prohibits deflecting humor"],
      verification: "All seven contexts have explicit personality levels, suppressions, and completion tests.",
    },
    {
      reviewAreaId: "public-private-knowledge-disclosure", decision: "bounded", releaseBlock: true,
      rationale: "Personality cannot be used to excuse private-memory disclosure, and public surfaces must remain limited to approved public evidence.",
      controls: ["public context suppresses private knowledge", "private retrieval requires authorization", "citations remain visible for retrieved claims"],
      verification: "Public and private behavior contexts preserve distinct disclosure rules.",
    },
    {
      reviewAreaId: "voice-singing-and-audio-training", decision: "deferred-separate-gate", releaseBlock: true,
      rationale: "Text behavior research does not authorize vocal timbre, singing, audio training, voice cloning, or a recognizable real-person performance.",
      controls: ["voice imitation prohibited", "no audio or video stored", "separate original-voice and provider-rights review required"],
      verification: "Voice work remains outside this artifact and blocked by a separate release gate.",
    },
    {
      reviewAreaId: "legal-clearance", decision: "not-legal-clearance", releaseBlock: true,
      rationale: "This is a product-engineering and trust-control review, not legal advice, a rights license, performer consent, or a determination of lawful use.",
      controls: ["legal clearance explicitly not established", "public release remains separate", "provider and performer terms require separate review"],
      verification: "The release disposition cannot be interpreted as permission to deploy or commercialize.",
    },
  ];
}

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
