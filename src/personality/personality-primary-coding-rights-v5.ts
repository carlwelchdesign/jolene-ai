import type { PersonalityPrimaryCodingArtifactV5 } from
  "./personality-primary-coding-v5.js";

export interface TransientPrimaryCodingRightsInput {
  readonly selectionId: string;
  readonly sourceText: string;
}

export interface PrimaryCodingRightsValidationV5 {
  readonly turns: 120;
  readonly maximumConsecutiveOverlapWords: number;
  readonly eightWordSourceOverlaps: 0;
  readonly sourceContentStored: false;
}

export function validatePrimaryCodingRightsV5(
  artifact: PersonalityPrimaryCodingArtifactV5,
  orderedTransientSource: readonly TransientPrimaryCodingRightsInput[],
): PrimaryCodingRightsValidationV5 {
  if (artifact.turns.length !== 120 || orderedTransientSource.length !== 120) {
    throw new Error("Rights validation requires exactly 120 aligned source turns");
  }
  let maximumConsecutiveOverlapWords = 0;
  let eightWordSourceOverlaps = 0;
  artifact.turns.forEach((turn, index) => {
    const source = orderedTransientSource[index];
    if (!source) throw new Error(`Missing transient rights input for ${turn.observationId}`);
    const overlap = longestConsecutiveWordOverlap(turn.paraphrase, source.sourceText);
    maximumConsecutiveOverlapWords = Math.max(maximumConsecutiveOverlapWords, overlap);
    if (overlap >= 8) eightWordSourceOverlaps += 1;
  });
  if (eightWordSourceOverlaps > 0) {
    throw new Error(
      `Primary coding contains ${eightWordSourceOverlaps} paraphrase/source overlaps of eight or more words`,
    );
  }
  return {
    turns: 120,
    maximumConsecutiveOverlapWords,
    eightWordSourceOverlaps: 0,
    sourceContentStored: false,
  };
}

export function longestConsecutiveWordOverlap(left: string, right: string): number {
  const leftWords = words(left);
  const rightWords = words(right);
  let maximum = 0;
  for (let leftIndex = 0; leftIndex < leftWords.length; leftIndex += 1) {
    for (let rightIndex = 0; rightIndex < rightWords.length; rightIndex += 1) {
      let count = 0;
      while (leftWords[leftIndex + count] &&
          leftWords[leftIndex + count] === rightWords[rightIndex + count]) count += 1;
      maximum = Math.max(maximum, count);
    }
  }
  return maximum;
}

function words(value: string): readonly string[] {
  return value.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/gu, " ")
    .trim().split(/\s+/u).filter(Boolean);
}
