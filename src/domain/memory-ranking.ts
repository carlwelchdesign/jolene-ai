import type {
  DurableMemory,
  MemorySelectionEvidence,
  WorkTask,
} from "./work-context.js";

export interface RankMemoryInput {
  readonly candidates: readonly DurableMemory[];
  readonly query: string | undefined;
  readonly task: WorkTask | null;
  readonly limit: number;
}

export interface RankedMemoryResult {
  readonly memories: readonly DurableMemory[];
  readonly evidence: readonly MemorySelectionEvidence[];
  readonly candidateCount: number;
  readonly queryTerms: readonly string[];
}

interface ScoredMemory {
  readonly memory: DurableMemory;
  readonly score: number;
  readonly matchedTerms: readonly string[];
  readonly reasons: readonly string[];
}

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
  "for",
  "from",
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

export function rankMemories(input: RankMemoryInput): RankedMemoryResult {
  const queryTerms = tokenize(input.query ?? "");
  const taskTerms = input.task
    ? tokenize(`${input.task.title} ${input.task.objective}`)
    : [];
  const scored = input.candidates
    .map((memory) => scoreMemory(memory, queryTerms, taskTerms, input.task))
    .filter((candidate): candidate is ScoredMemory => candidate !== null)
    .sort(compareScoredMemories)
    .slice(0, Math.max(1, input.limit));

  return {
    memories: scored.map((candidate) => candidate.memory),
    evidence: scored.map((candidate) => ({
      memoryId: candidate.memory.id,
      score: candidate.score,
      matchedTerms: candidate.matchedTerms,
      reasons: candidate.reasons,
    })),
    candidateCount: input.candidates.length,
    queryTerms,
  };
}

function scoreMemory(
  memory: DurableMemory,
  queryTerms: readonly string[],
  taskTerms: readonly string[],
  task: WorkTask | null,
): ScoredMemory | null {
  const memoryTerms = new Set(tokenize(memory.content));
  const matchedQueryTerms = queryTerms.filter((term) => memoryTerms.has(term));
  const matchedTaskTerms = taskTerms.filter((term) => memoryTerms.has(term));
  const taskScoped = Boolean(task && memory.taskId === task.id);
  const baseline = memory.kind === "standing_rule"
    ? 10
    : memory.kind === "preference"
      ? 5
      : 0;

  if (
    queryTerms.length > 0 &&
    matchedQueryTerms.length === 0 &&
    matchedTaskTerms.length === 0 &&
    !taskScoped &&
    baseline === 0
  ) {
    return null;
  }

  const reasons: string[] = [];
  if (matchedQueryTerms.length > 0) reasons.push("query_term_match");
  if (matchedTaskTerms.length > 0) reasons.push("task_term_match");
  if (taskScoped) reasons.push("selected_task_scope");
  if (memory.kind === "standing_rule") reasons.push("standing_rule_baseline");
  if (memory.kind === "preference") reasons.push("preference_baseline");
  if (queryTerms.length === 0) reasons.push("recency_fallback");

  return {
    memory,
    score:
      matchedQueryTerms.length * 100 +
      matchedTaskTerms.length * 20 +
      (taskScoped ? 15 : 0) +
      baseline,
    matchedTerms: [...new Set([...matchedQueryTerms, ...matchedTaskTerms])],
    reasons,
  };
}

function compareScoredMemories(left: ScoredMemory, right: ScoredMemory): number {
  if (left.score !== right.score) return right.score - left.score;
  const recency = right.memory.createdAt.localeCompare(left.memory.createdAt);
  return recency !== 0 ? recency : left.memory.id.localeCompare(right.memory.id);
}

function tokenize(value: string): string[] {
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
