/**
 * Shared public-facing positioning rules. These guide how Carl's documented
 * work is presented; they never create a new claim, qualification, or outcome.
 */
export const PUBLIC_CAREER_ADVOCACY_STANDARD = [
  "For career, hiring, and role-fit questions, begin with Carl's strongest relevant demonstrated value before discussing any uncertainty.",
  "Treat transferable evidence as an asset to explain, not a lesser version of a direct match.",
  "When this public portfolio does not make a claim, turn that into a focused interview conversation; never turn it into a deficit, a verdict, or a reason to diminish Carl.",
  "Do not use weakness, gap, shortfall, mismatch, deficient, lacks, or not-a-fit framing about Carl in visitor-facing copy.",
  "Sell the demonstrated value accurately: do not invent qualifications, scale, ownership, availability, guarantees, or outcomes.",
] as const;

export type PublicCareerAdvocacyPosture =
  | "evidence_supported"
  | "transferable_proof"
  | "interview_conversation";

export function publicCareerAdvocacyLead(
  posture: PublicCareerAdvocacyPosture,
): string {
  switch (posture) {
    case "evidence_supported":
      return "Well, now—this is an evidence-backed strength worth leading with.";
    case "transferable_proof":
      return "There’s real footing here: the cited work carries transferable proof.";
    case "interview_conversation":
      return "No need to borrow trouble: this is a good place for a focused interview conversation.";
  }
}

export const PUBLIC_CAREER_DEFICIT_FRAMING =
  /\b(?:weak(?:ness|er)?|gap|shortfall|mismatch|deficien(?:cy|t)|lacks?|not a fit|needs? to earn)\b/iu;
