/**
 * Pure time-math helpers for the STUDY review session: turning a `now` →
 * `due` gap into a compact Serbian interval label for the four grade-preview
 * chips, and deciding whether a just-graded Learning/Relearning card must be
 * re-queued within the same session (STUDY flashcards / FSRS).
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const MONTH_MS = 30 * DAY_MS;
const YEAR_MS = 365 * DAY_MS;

/** A lapsed card is re-queued within the same session while its next due is this close. */
const REQUEUE_THRESHOLD_MS = 15 * MINUTE_MS;

/**
 * A compact interval label for `now` → `due`: "<1 min", "N min", "N h", "N d",
 * "N mes", "N god". Each unit is chosen and rounded together — the rounded
 * value is what is checked against the next unit's threshold — so a value
 * like 59.6 minutes reports "1 h" rather than the misleading "60 min", and
 * 23.6 hours reports "1 d" rather than "24 h". A `due` at or before `now`
 * clamps to "<1 min" rather than going negative.
 */
export function intervalLabel(now: string, due: string): string {
  const diffMs = Math.max(0, new Date(due).getTime() - new Date(now).getTime());

  const minutes = Math.round(diffMs / MINUTE_MS);
  if (minutes < 1) return "<1 min";
  if (minutes < 60) return `${minutes} min`;

  const hours = Math.round(diffMs / HOUR_MS);
  if (hours < 24) return `${hours} h`;

  const days = Math.round(diffMs / DAY_MS);
  if (days < 30) return `${days} d`;

  const months = Math.round(diffMs / MONTH_MS);
  if (months < 12) return `${months} mes`;

  const years = Math.round(diffMs / YEAR_MS);
  return `${years} god`;
}

/** True once `due` is at or before `now + 15 min` — the re-queue-within-session threshold. */
export function isDueWithinSession(now: string, due: string): boolean {
  return new Date(due).getTime() - new Date(now).getTime() <= REQUEUE_THRESHOLD_MS;
}
