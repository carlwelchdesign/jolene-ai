import type { PublicCareerEvidenceRecord } from
  "../domain/public-career-evidence.js";

export const INTERNAL_PUBLIC_PROCESS_LANGUAGE_PATTERNS = [
  /\bcontribution boundary\b/iu,
  /\bimported from (?:the )?portfolio\b/iu,
  /\brequires? review\b/iu,
  /\bpublic-approved\b/iu,
  /\bpreserved source material\b/iu,
  /\bverified from\b/iu,
  /\breviewed public (?:evidence|record)\b/iu,
  /\bpublic corpus\b/iu,
  /\bevery supporting reference\b/iu,
] as const;

export function containsInternalPublicProcessLanguage(value: string): boolean {
  return INTERNAL_PUBLIC_PROCESS_LANGUAGE_PATTERNS.some((pattern) => pattern.test(value));
}

export function visitorFacingLimitations(
  limitations: readonly string[],
): readonly string[] {
  return [...new Set(limitations
    .map(toVisitorFacingLimitation)
    .filter((value): value is string => Boolean(value))
    .filter((value) => !containsInternalPublicProcessLanguage(value)))];
}

export function visitorFacingClaim(
  claim: PublicCareerEvidenceRecord["claim"],
): PublicCareerEvidenceRecord["claim"] {
  return {
    ...claim,
    limitations: [...visitorFacingLimitations(claim.limitations)],
  };
}

function toVisitorFacingLimitation(value: string): string | null {
  const candidate = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (!candidate) return null;
  if (containsInternalPublicProcessLanguage(candidate)) return null;
  return candidate;
}
