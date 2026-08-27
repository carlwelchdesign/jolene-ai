const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "did",
  "do",
  "does",
  "for",
  "from",
  "had",
  "has",
  "have",
  "how",
  "i",
  "in",
  "is",
  "it",
  "me",
  "my",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "we",
  "what",
  "with",
  "you",
]);

export function tokenizeLexicalTerms(value: string): string[] {
  return [
    ...new Set(
      value
        .toLocaleLowerCase("en-US")
        .normalize("NFKC")
        .split(/[^\p{L}\p{N}]+/u)
        .filter((term) => term.length >= 2 && !STOP_WORDS.has(term))
        .slice(0, 80),
    ),
  ];
}
