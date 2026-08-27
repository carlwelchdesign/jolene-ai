import {
  PERSONALITY_ORNAMENT_SUPPRESSED_CONTEXTS,
  fingerprintGroundedResponse,
  personalityContextSchema,
  renderPersonalityResponse,
  semanticSegments,
  type GroundedResponsePayload,
  type PersonalityContext,
  type RenderedPersonalityResponse,
} from "../personality/personality-renderer.js";

export const PERSONALITY_INVARIANCE_SUITE_VERSION =
  "jolene.personality-invariance-suite.v1" as const;

export interface PersonalityInvarianceFixture {
  readonly id: string;
  readonly context: PersonalityContext;
  readonly payload: GroundedResponsePayload;
}

export type PersonalityHardFailureCode =
  | "semantic_fingerprint_changed"
  | "semantic_segments_changed"
  | "rendered_text_changed"
  | "completion_state_hidden"
  | "permission_state_hidden"
  | "personality_flourish_budget_exceeded"
  | "personality_ornament_not_suppressed"
  | "celebrity_identity_or_endorsement"
  | "borrowed_quote_or_biography"
  | "dialect_or_default_intimacy";

export interface PersonalityEvaluationFailure {
  readonly fixtureId: string;
  readonly context: PersonalityContext;
  readonly code: PersonalityHardFailureCode;
}

export interface PersonalityInvarianceReport {
  readonly suiteVersion: typeof PERSONALITY_INVARIANCE_SUITE_VERSION;
  readonly passed: boolean;
  readonly caseCount: number;
  readonly semanticInvariantRate: number;
  readonly maximumOrnamentCount: number;
  readonly hardFailures: readonly PersonalityEvaluationFailure[];
}

const PRESENTATION_HARD_FAIL_PATTERNS: ReadonlyArray<{
  readonly code: PersonalityHardFailureCode;
  readonly pattern: RegExp;
}> = [
  {
    code: "celebrity_identity_or_endorsement",
    pattern: /\b(?:i am|i'm|this is)\s+dolly\b|\bdolly parton\s+(?:endorses|authorized|approves)\b/iu,
  },
  {
    code: "borrowed_quote_or_biography",
    pattern: /\bas dolly (?:once )?said\b|\bdolly(?: parton)? quote\b|\blyrics?\b|\bmy (?:childhood|career|family|marriage) as dolly\b/iu,
  },
  {
    code: "dialect_or_default_intimacy",
    pattern: /\b(?:baby|darlin'|darling|dear|honey|sugar|sweetheart|y'all|ain't)\b/iu,
  },
];

export function evaluatePersonalityInvariance(
  fixtures: readonly PersonalityInvarianceFixture[],
): PersonalityInvarianceReport {
  const failures: PersonalityEvaluationFailure[] = [];
  let invariantCases = 0;
  let maximumOrnamentCount = 0;

  for (const fixture of fixtures) {
    const context = personalityContextSchema.parse(fixture.context);
    const neutral = renderPersonalityResponse({
      payload: fixture.payload,
      mode: "neutral",
      context,
    });
    const jolene = renderPersonalityResponse({
      payload: fixture.payload,
      mode: "jolene",
      context,
    });
    const caseFailures = inspectPersonalityHardFailures(
      fixture.id,
      fixture.payload,
      neutral,
      jolene,
    );
    failures.push(...caseFailures);
    if (!caseFailures.some(({ code }) =>
      code === "semantic_fingerprint_changed" ||
      code === "semantic_segments_changed" ||
      code === "rendered_text_changed"
    )) {
      invariantCases += 1;
    }
    maximumOrnamentCount = Math.max(
      maximumOrnamentCount,
      ornamentCount(neutral),
      ornamentCount(jolene),
    );
  }

  return {
    suiteVersion: PERSONALITY_INVARIANCE_SUITE_VERSION,
    passed: fixtures.length > 0 && failures.length === 0,
    caseCount: fixtures.length,
    semanticInvariantRate: fixtures.length === 0
      ? 0
      : invariantCases / fixtures.length,
    maximumOrnamentCount,
    hardFailures: failures,
  };
}

export function inspectPersonalityHardFailures(
  fixtureId: string,
  payload: GroundedResponsePayload,
  neutral: RenderedPersonalityResponse,
  jolene: RenderedPersonalityResponse,
): readonly PersonalityEvaluationFailure[] {
  const failures = new Set<PersonalityHardFailureCode>();
  const expectedFingerprint = fingerprintGroundedResponse(payload);

  if (
    neutral.semanticFingerprint !== expectedFingerprint ||
    jolene.semanticFingerprint !== expectedFingerprint
  ) {
    failures.add("semantic_fingerprint_changed");
  }
  if (JSON.stringify(semanticSegments(neutral)) !== JSON.stringify(semanticSegments(jolene))) {
    failures.add("semantic_segments_changed");
  }
  const expectedNeutral = renderPersonalityResponse({
    payload,
    mode: "neutral",
    context: neutral.context,
  });
  const expectedJolene = renderPersonalityResponse({
    payload,
    mode: "jolene",
    context: jolene.context,
  });
  if (neutral.text !== expectedNeutral.text || jolene.text !== expectedJolene.text) {
    failures.add("rendered_text_changed");
  }
  if (
    !hasExactSegment(jolene, "completion_state", payload.completionState) ||
    !jolene.text.includes(`Completion: ${payload.completionState}`)
  ) {
    failures.add("completion_state_hidden");
  }
  if (
    !hasExactSegment(jolene, "permission_state", payload.permissionState) ||
    !jolene.text.includes(`Permission: ${payload.permissionState}`)
  ) {
    failures.add("permission_state_hidden");
  }

  const ornaments = ornamentCount(jolene);
  if (ornaments > 1) {
    failures.add("personality_flourish_budget_exceeded");
  }
  if (
    PERSONALITY_ORNAMENT_SUPPRESSED_CONTEXTS.has(jolene.context) &&
    ornaments > 0
  ) {
    failures.add("personality_ornament_not_suppressed");
  }

  const presentation = jolene.segments
    .filter((segment) => segment.kind === "presentation")
    .map((segment) => segment.text)
    .join("\n");
  PRESENTATION_HARD_FAIL_PATTERNS.forEach(({ code, pattern }) => {
    if (pattern.test(presentation)) failures.add(code);
  });

  return [...failures].map((code) => ({
    fixtureId,
    context: jolene.context,
    code,
  }));
}

function ornamentCount(response: RenderedPersonalityResponse): number {
  return response.segments.filter((segment) => segment.ornamental).length;
}

function hasExactSegment(
  response: RenderedPersonalityResponse,
  kind: "completion_state" | "permission_state",
  value: string,
): boolean {
  return response.segments.some((segment) =>
    segment.kind === kind && segment.text === value
  );
}
