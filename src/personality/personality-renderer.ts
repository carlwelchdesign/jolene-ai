import { createHash } from "node:crypto";

import { z } from "zod";

import {
  personalityModeSchema,
  type PersonalityMode,
} from "./personality-mode.js";

export { personalityModeSchema, type PersonalityMode } from "./personality-mode.js";

export const PERSONALITY_RENDERER_SCHEMA_VERSION =
  "jolene.personality-renderer.v1" as const;

const stableIdSchema = z.string().regex(/^[a-z][a-z0-9._:-]{2,159}$/);

export const groundedCitationSchema = z.object({
  id: stableIdSchema,
  label: z.string().trim().min(1).max(240),
  locator: z.string().trim().min(1).max(500),
}).strict();

export const groundedClaimSchema = z.object({
  id: stableIdSchema,
  statement: z.string().trim().min(1).max(4_000),
  citationIds: z.array(stableIdSchema).min(1).max(12),
}).strict();

export const groundedResponsePayloadSchema = z.object({
  schemaVersion: z.literal(PERSONALITY_RENDERER_SCHEMA_VERSION),
  responseId: stableIdSchema,
  summary: z.string().trim().min(1).max(4_000),
  summaryCitationIds: z.array(stableIdSchema).min(1).max(12),
  claims: z.array(groundedClaimSchema).min(1).max(24),
  citations: z.array(groundedCitationSchema).min(1).max(48),
  limitations: z.array(z.string().trim().min(1).max(1_000)).max(12),
  nextActions: z.array(z.string().trim().min(1).max(1_000)).max(8),
  completionState: z.enum([
    "completed",
    "in_progress",
    "proposed",
    "blocked",
    "unknown",
  ]),
  permissionState: z.enum([
    "informational",
    "proposal_only",
    "approval_required",
  ]),
}).strict().superRefine((payload, context) => {
  const citationIds = payload.citations.map((citation) => citation.id);
  addDuplicateIssue(citationIds, "Citation IDs must be unique.", ["citations"], context);
  addDuplicateIssue(
    payload.claims.map((claim) => claim.id),
    "Claim IDs must be unique.",
    ["claims"],
    context,
  );

  const availableCitationIds = new Set(citationIds);
  const missingSummaryCitations = payload.summaryCitationIds.filter(
    (id) => !availableCitationIds.has(id),
  );
  if (missingSummaryCitations.length > 0) {
    context.addIssue({
      code: "custom",
      path: ["summaryCitationIds"],
      message: `Summary references unknown citations: ${missingSummaryCitations.join(", ")}.`,
    });
  }
  if (new Set(payload.summaryCitationIds).size !== payload.summaryCitationIds.length) {
    context.addIssue({
      code: "custom",
      path: ["summaryCitationIds"],
      message: "Summary citation IDs must be unique.",
    });
  }
  payload.claims.forEach((claim, claimIndex) => {
    const missing = claim.citationIds.filter((id) => !availableCitationIds.has(id));
    if (missing.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["claims", claimIndex, "citationIds"],
        message: `Claim references unknown citations: ${missing.join(", ")}.`,
      });
    }
    if (new Set(claim.citationIds).size !== claim.citationIds.length) {
      context.addIssue({
        code: "custom",
        path: ["claims", claimIndex, "citationIds"],
        message: "Claim citation IDs must be unique.",
      });
    }
  });
});

export const personalityContextSchema = z.enum([
  "casual_planning",
  "technical_work",
  "overwhelmed",
  "grief_or_acute_pain",
  "conflict",
  "error_ownership",
  "high_stakes",
  "urgent_incident",
  "celebration",
  "public_or_shared",
  "voice",
]);

export type GroundedResponsePayload = z.infer<
  typeof groundedResponsePayloadSchema
>;
export type PersonalityContext = z.infer<typeof personalityContextSchema>;

export interface PersonalityRenderRequest {
  readonly payload: GroundedResponsePayload;
  readonly mode: PersonalityMode;
  readonly context: PersonalityContext;
}

export type PersonalitySegmentKind =
  | "presentation"
  | "summary"
  | "claim"
  | "citation"
  | "limitations"
  | "next_actions"
  | "completion_state"
  | "permission_state";

export interface PersonalityRenderSegment {
  readonly kind: PersonalitySegmentKind;
  readonly text: string;
  readonly ornamental: boolean;
}

export interface RenderedPersonalityResponse {
  readonly schemaVersion: typeof PERSONALITY_RENDERER_SCHEMA_VERSION;
  readonly responseId: string;
  readonly mode: PersonalityMode;
  readonly context: PersonalityContext;
  readonly semanticFingerprint: string;
  readonly segments: readonly PersonalityRenderSegment[];
  readonly text: string;
}

const PRESENTATION: Readonly<
  Record<PersonalityContext, { readonly text: string | null; readonly ornamental: boolean }>
> = {
  casual_planning: {
    text: "That has good bones. Here is the useful part.",
    ornamental: true,
  },
  technical_work: {
    text: "Here is the clean read.",
    ornamental: true,
  },
  overwhelmed: {
    text: "Let us make this smaller and take the blocking piece first.",
    ornamental: false,
  },
  grief_or_acute_pain: {
    text: "I am sorry. I will keep this steady and simple.",
    ornamental: false,
  },
  conflict: {
    text: "Let us separate the facts, the risk, and the next move.",
    ornamental: false,
  },
  error_ownership: {
    text: "I got that wrong. Here is the correction.",
    ornamental: false,
  },
  high_stakes: { text: null, ornamental: false },
  urgent_incident: { text: null, ornamental: false },
  celebration: {
    text: "That is worth celebrating. Here is what the evidence supports.",
    ornamental: true,
  },
  public_or_shared: {
    text: "Here is the evidence-backed answer.",
    ornamental: false,
  },
  voice: {
    text: "Here is the short version.",
    ornamental: false,
  },
};

export const PERSONALITY_ORNAMENT_SUPPRESSED_CONTEXTS: ReadonlySet<PersonalityContext> =
  new Set([
    "overwhelmed",
    "grief_or_acute_pain",
    "conflict",
    "error_ownership",
    "high_stakes",
    "urgent_incident",
    "public_or_shared",
    "voice",
  ]);

export function fingerprintGroundedResponse(
  input: GroundedResponsePayload,
): string {
  const payload = groundedResponsePayloadSchema.parse(input);
  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}

export function renderPersonalityResponse(
  input: PersonalityRenderRequest,
): RenderedPersonalityResponse {
  const payload = groundedResponsePayloadSchema.parse(input.payload);
  const mode = personalityModeSchema.parse(input.mode);
  const context = personalityContextSchema.parse(input.context);
  const segments: PersonalityRenderSegment[] = [];
  const presentation = PRESENTATION[context];

  if (mode === "jolene" && presentation.text) {
    segments.push({
      kind: "presentation",
      text: presentation.text,
      ornamental: presentation.ornamental,
    });
  }

  segments.push({
    kind: "summary",
    text: `${payload.summary} [${payload.summaryCitationIds.join(", ")}]`,
    ornamental: false,
  });
  payload.claims.forEach((claim) => {
    segments.push({
      kind: "claim",
      text: `${claim.statement} [${claim.citationIds.join(", ")}]`,
      ornamental: false,
    });
  });
  payload.citations.forEach((citation) => {
    segments.push({
      kind: "citation",
      text: `[${citation.id}] ${citation.label} — ${citation.locator}`,
      ornamental: false,
    });
  });
  segments.push({
    kind: "limitations",
    text: payload.limitations.length > 0
      ? payload.limitations.join("\n")
      : "None recorded.",
    ornamental: false,
  });
  segments.push({
    kind: "next_actions",
    text: payload.nextActions.length > 0
      ? payload.nextActions.join("\n")
      : "None proposed.",
    ornamental: false,
  });
  segments.push({
    kind: "completion_state",
    text: payload.completionState,
    ornamental: false,
  });
  segments.push({
    kind: "permission_state",
    text: payload.permissionState,
    ornamental: false,
  });

  return {
    schemaVersion: PERSONALITY_RENDERER_SCHEMA_VERSION,
    responseId: payload.responseId,
    mode,
    context,
    semanticFingerprint: fingerprintGroundedResponse(payload),
    segments,
    text: formatSegments(segments),
  };
}

export function semanticSegments(
  response: RenderedPersonalityResponse,
): readonly PersonalityRenderSegment[] {
  return response.segments.filter((segment) => segment.kind !== "presentation");
}

function formatSegments(segments: readonly PersonalityRenderSegment[]): string {
  return segments.map((segment) => {
    switch (segment.kind) {
      case "presentation":
      case "summary":
        return segment.text;
      case "claim":
        return `Evidence: ${segment.text}`;
      case "citation":
        return `Citation: ${segment.text}`;
      case "limitations":
        return `Limitations:\n${segment.text}`;
      case "next_actions":
        return `Next actions:\n${segment.text}`;
      case "completion_state":
        return `Completion: ${segment.text}`;
      case "permission_state":
        return `Permission: ${segment.text}`;
    }
  }).join("\n\n");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${stableStringify(record[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function addDuplicateIssue(
  values: readonly string[],
  message: string,
  path: PropertyKey[],
  context: z.RefinementCtx,
): void {
  if (new Set(values).size !== values.length) {
    context.addIssue({ code: "custom", path, message });
  }
}
