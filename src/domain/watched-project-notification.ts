import type {
  WatchedProjectNotificationIntent,
  WatchedProjectNotificationPolicy,
  WatchedProjectSnapshot,
} from "./watched-project.js";

export function deriveWatchedProjectNotification(
  previous: WatchedProjectSnapshot | null,
  current: WatchedProjectSnapshot,
  trigger: "scheduled" | "manual",
  policy: WatchedProjectNotificationPolicy,
): WatchedProjectNotificationIntent | null {
  if (!policy.enabled || trigger !== "scheduled") return null;

  const previousAlerts = previous?.alerts ?? [];
  const currentAlerts = current.alerts;
  if (previousAlerts.length === 0 && currentAlerts.length === 0) return null;

  if (previousAlerts.length === 0) {
    return {
      transition: "attention_started",
      alertCodes: [...currentAlerts].sort(),
      checkedAt: current.checkedAt,
    };
  }

  if (currentAlerts.length === 0) {
    return {
      transition: "attention_resolved",
      alertCodes: [...previousAlerts].sort(),
      checkedAt: current.checkedAt,
    };
  }

  if (sameAlerts(previousAlerts, currentAlerts)) return null;
  return {
    transition: "attention_changed",
    alertCodes: [...currentAlerts].sort(),
    checkedAt: current.checkedAt,
  };
}

function sameAlerts(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const expected = new Set(left);
  return right.every((value) => expected.has(value));
}
