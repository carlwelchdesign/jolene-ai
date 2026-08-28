import { createHash } from "node:crypto";

import type { PublicCareerEvidenceRecord } from
  "../domain/public-career-evidence.js";
import type { ContactIntentRequest } from
  "../domain/public-portfolio-contract.js";
import {
  createUntrustedContentEnvelope,
  deriveUntrustedContentEnvelope,
  parseUntrustedContentEnvelope,
  serializeUntrustedContentEnvelope,
  type UntrustedContentEnvelope,
  type UntrustedContentPurpose,
} from "../domain/untrusted-content.js";
import type { GroundedPublicAnswerInput } from "./public-answer-service.js";

export function publicGroundedAnswerEnvelopes(
  input: GroundedPublicAnswerInput,
  observedAt: string,
): readonly UntrustedContentEnvelope[] {
  return [
    createPublicTextEnvelope({
      originKind: "user_message",
      sourceId: `public-question:${digest(input.question).slice(0, 32)}`,
      purpose: "answer_context",
      text: input.question,
      observedAt,
      reviewedAt: null,
    }),
    ...input.evidence.map((evidence) => createPublicTextEnvelope({
      originKind: evidence.citationTitle.startsWith("Recommendation from ")
        ? "recommendation"
        : "career_evidence",
      sourceId: `public-evidence:${digest(JSON.stringify(evidence)).slice(0, 32)}`,
      purpose: "retrieval_evidence",
      text: JSON.stringify(evidence),
      observedAt,
      reviewedAt: observedAt,
    })),
  ];
}

export function serializePublicGroundedAnswerInput(
  input: GroundedPublicAnswerInput,
  observedAt: string,
): string {
  return serializeCollection(publicGroundedAnswerEnvelopes(input, observedAt));
}

export function serializePublicEmbeddingQuestion(
  question: string,
  observedAt: string,
): string {
  return serializeUntrustedContentEnvelope(createPublicTextEnvelope({
    originKind: "user_message",
    sourceId: `public-question:${digest(question).slice(0, 32)}`,
    purpose: "retrieval_evidence",
    text: question,
    observedAt,
    reviewedAt: null,
  }));
}

export function serializePublicEmbeddingEvidence(
  record: PublicCareerEvidenceRecord,
): string {
  return serializeUntrustedContentEnvelope(createPublicTextEnvelope({
    originKind: record.citation.title.startsWith("Recommendation from ")
      ? "recommendation"
      : "career_evidence",
    sourceId: record.evidenceId,
    purpose: "retrieval_evidence",
    text: [
      record.citation.title,
      record.claim.text,
      record.claim.limitations.join(" "),
      record.citation.sourceType,
      record.citation.maturity,
    ].filter(Boolean).join("\n"),
    observedAt: record.citation.lastReviewedAt,
    reviewedAt: record.citation.lastReviewedAt,
  }));
}

export function createPublicJobDescriptionEnvelope(
  jobDescription: string,
  observedAt: string,
): UntrustedContentEnvelope {
  return createUntrustedContentEnvelope({
    origin: {
      kind: "job_description",
      sourceId: `job-description:${digest(jobDescription).slice(0, 32)}`,
    },
    scope: publicAnonymousScope(),
    classification: "internal",
    purpose: "job_fit_comparison",
    disclosureCeiling: "no_disclosure",
    review: { status: "unreviewed", reviewedAt: null },
    freshness: { observedAt, expiresAt: null, status: "unknown" },
    revocation: { status: "active", revokedAt: null, reasonCode: null },
    payload: { kind: "text", text: jobDescription },
  });
}

export function createContactSubmissionEnvelope(
  request: ContactIntentRequest,
  intentId: string,
  observedAt: string,
  expiresAt: string,
): UntrustedContentEnvelope {
  return createUntrustedContentEnvelope({
    origin: { kind: "contact_submission", sourceId: `contact-intent:${intentId}` },
    scope: publicAnonymousScope(),
    classification: "sensitive",
    purpose: "contact_review",
    disclosureCeiling: "no_disclosure",
    review: { status: "unreviewed", reviewedAt: null },
    freshness: { observedAt, expiresAt, status: "fresh" },
    revocation: { status: "active", revokedAt: null, reasonCode: null },
    payload: {
      kind: "json",
      value: JSON.parse(JSON.stringify(request)) as Record<string, string | boolean>,
    },
  });
}

export function createPublicExternalAiTextEnvelope(input: {
  readonly answer: string;
  readonly parents: readonly UntrustedContentEnvelope[];
  readonly model: string;
  readonly observedAt: string;
}): UntrustedContentEnvelope {
  const envelope = deriveUntrustedContentEnvelope({
    origin: {
      kind: "external_ai_text",
      sourceId: `public-model:${safeModelId(input.model)}`,
    },
    parents: input.parents,
    scope: publicAnonymousScope(),
    purpose: "external_ai_exchange",
    payload: { kind: "text", text: input.answer },
    observedAt: input.observedAt,
  });
  return requirePublicSafeEnvelope(envelope);
}

export function requirePublicSafeEnvelope(
  input: unknown,
): UntrustedContentEnvelope {
  const envelope = parseUntrustedContentEnvelope(input);
  if (
    envelope.classification !== "public" ||
    envelope.disclosureCeiling !== "public" ||
    Object.values(envelope.scope).some((value) => value !== null) ||
    !PUBLIC_SOURCE_ID_PATTERNS.some((pattern) =>
      pattern.test(envelope.origin.sourceId)
    )
  ) {
    throw new Error("Public model data envelope contains non-public metadata.");
  }
  return envelope;
}

const PUBLIC_SOURCE_ID_PATTERNS = [
  /^public-question:[a-f0-9]{32}$/u,
  /^public-evidence:[a-f0-9]{32}$/u,
  /^career:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  /^public-model:[a-z0-9._-]{1,80}$/u,
] as const;

function createPublicTextEnvelope(input: {
  readonly originKind: "user_message" | "career_evidence" | "recommendation";
  readonly sourceId: string;
  readonly purpose: UntrustedContentPurpose;
  readonly text: string;
  readonly observedAt: string;
  readonly reviewedAt: string | null;
}): UntrustedContentEnvelope {
  return requirePublicSafeEnvelope(createUntrustedContentEnvelope({
    origin: { kind: input.originKind, sourceId: input.sourceId },
    scope: publicAnonymousScope(),
    classification: "public",
    purpose: input.purpose,
    disclosureCeiling: "public",
    review: input.reviewedAt
      ? { status: "approved", reviewedAt: input.reviewedAt }
      : { status: "unreviewed", reviewedAt: null },
    freshness: { observedAt: input.observedAt, expiresAt: null, status: "unknown" },
    revocation: { status: "active", revokedAt: null, reasonCode: null },
    payload: { kind: "text", text: input.text },
  }));
}

function publicAnonymousScope() {
  return {
    actorId: null,
    workspaceId: null,
    channelKind: null,
    channelId: null,
    threadId: null,
  } as const;
}

function serializeCollection(envelopes: readonly UntrustedContentEnvelope[]): string {
  return `[${envelopes.map(serializeUntrustedContentEnvelope).join(",")}]`;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeModelId(model: string): string {
  const normalized = model.trim().toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9._-]+/gu, "-")
    .slice(0, 80);
  return normalized || "unknown";
}
