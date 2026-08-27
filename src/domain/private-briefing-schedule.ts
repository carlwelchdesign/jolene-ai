import type { PrivateBriefingPolicy } from "./private-briefing.js";

const SEARCH_LIMIT_MINUTES = 8 * 24 * 60;

export function nextPrivateBriefingOccurrence(
  after: Date,
  policy: PrivateBriefingPolicy,
): Date {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: policy.timeZone,
    hourCycle: "h23",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  const start = Math.floor(after.getTime() / 60_000) * 60_000 + 60_000;
  for (let offset = 0; offset < SEARCH_LIMIT_MINUTES; offset += 1) {
    const candidate = new Date(start + offset * 60_000);
    const parts = Object.fromEntries(
      formatter.formatToParts(candidate).map((part) => [part.type, part.value]),
    );
    if (
      Number(parts.hour) === policy.localHour &&
      Number(parts.minute) === policy.localMinute &&
      (policy.frequency === "daily" || weekday(parts.weekday) === policy.dayOfWeek)
    ) {
      return candidate;
    }
  }
  throw new Error("No private briefing occurrence was found inside the schedule window.");
}

function weekday(value: string | undefined): number {
  const days: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return value ? (days[value] ?? -1) : -1;
}
