import { tokenizeLexicalTerms } from "./lexical-terms.js";
import type {
  TaskEvent,
  TaskEventSelectionEvidence,
} from "./work-context.js";

export interface RankTaskEventsInput {
  readonly candidates: readonly TaskEvent[];
  readonly query: string | undefined;
  readonly limit: number;
}

export interface RankedTaskEventResult {
  readonly events: readonly TaskEvent[];
  readonly evidence: readonly TaskEventSelectionEvidence[];
  readonly candidateCount: number;
  readonly recentCount: number;
  readonly queryTerms: readonly string[];
}

interface ScoredTaskEvent {
  readonly event: TaskEvent;
  readonly score: number;
  readonly matchedTerms: readonly string[];
  readonly reasons: readonly string[];
}

export function rankTaskEvents(
  input: RankTaskEventsInput,
): RankedTaskEventResult {
  const limit = Math.max(1, input.limit);
  const queryTerms = tokenizeLexicalTerms(input.query ?? "");
  const recentReserve = queryTerms.length === 0
    ? limit
    : limit === 1
      ? 0
      : Math.max(1, Math.floor(limit / 3));
  const recentEvents = recentReserve === 0
    ? []
    : input.candidates.slice(-recentReserve);
  const recentIds = new Set(recentEvents.map((event) => event.id));
  const scoredById = new Map(
    input.candidates
      .map((event) => scoreTaskEvent(event, queryTerms))
      .filter((event): event is ScoredTaskEvent => event !== null)
      .map((event) => [event.event.id, event]),
  );
  const relevantEvents = [...scoredById.values()].sort(compareScoredEvents);
  const selectedIds = new Set<string>();

  for (const event of relevantEvents) {
    if (selectedIds.size >= limit - recentReserve) break;
    selectedIds.add(event.event.id);
  }
  for (const event of recentEvents) selectedIds.add(event.id);
  for (const event of [...input.candidates].reverse()) {
    if (selectedIds.size >= limit) break;
    selectedIds.add(event.id);
  }

  const events = input.candidates.filter((event) => selectedIds.has(event.id));
  const evidence = events.map((event) => {
    const scored = scoredById.get(event.id);
    const reasons = [...(scored?.reasons ?? [])];
    if (recentIds.has(event.id)) reasons.push("recent_continuity");
    if (reasons.length === 0) reasons.push("recency_fallback");
    return {
      eventId: event.id,
      score: scored?.score ?? 0,
      matchedTerms: scored?.matchedTerms ?? [],
      reasons,
    };
  });

  return {
    events,
    evidence,
    candidateCount: input.candidates.length,
    recentCount: events.filter((event) => recentIds.has(event.id)).length,
    queryTerms,
  };
}

function scoreTaskEvent(
  event: TaskEvent,
  queryTerms: readonly string[],
): ScoredTaskEvent | null {
  if (queryTerms.length === 0) return null;
  const summaryTerms = new Set(tokenizeLexicalTerms(event.summary));
  const detailsTerms = new Set(tokenizeLexicalTerms(event.details ?? ""));
  const summaryMatches = queryTerms.filter((term) => summaryTerms.has(term));
  const detailMatches = queryTerms.filter((term) => detailsTerms.has(term));
  const matchedTerms = [...new Set([...summaryMatches, ...detailMatches])];
  if (matchedTerms.length === 0) return null;

  const reasons: string[] = [];
  if (summaryMatches.length > 0) reasons.push("summary_term_match");
  if (detailMatches.length > 0) reasons.push("details_term_match");
  return {
    event,
    score: summaryMatches.length * 100 + detailMatches.length * 40,
    matchedTerms,
    reasons,
  };
}

function compareScoredEvents(
  left: ScoredTaskEvent,
  right: ScoredTaskEvent,
): number {
  if (left.score !== right.score) return right.score - left.score;
  const recency = right.event.createdAt.localeCompare(left.event.createdAt);
  return recency !== 0 ? recency : left.event.id.localeCompare(right.event.id);
}
