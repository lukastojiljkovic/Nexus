/**
 * Pure streak computation for the STUDY stats module (piece 4a): turns a set of
 * bare "YYYY-MM-DD" activity days into current/best consecutive-day streaks.
 * No clock reads — `today` is an explicit bare-date input, mirroring
 * `planEngine.ts`'s idiom exactly. The desktop renderer is the caller: it takes
 * the `activityDays` from the `stats:study` IPC payload plus its own local
 * today-key and derives the streaks for display.
 *
 * All date math happens at UTC midnight (`${d}T00:00:00.000Z`), mirroring
 * `planEngine.ts`, so a bare date never shifts by a day regardless of the
 * host's timezone.
 */

const MS_PER_DAY = 86_400_000;

/** Current and best consecutive-day study streaks, in days. */
export interface StreakResult {
  current: number;
  best: number;
}

/** UTC-midnight ms for a bare "YYYY-MM-DD" prefix (mirrors `planEngine.ts`'s `utcDayMs`). */
function utcDayMs(dateKey: string): number {
  const [yearPart, monthPart, dayPart] = dateKey.slice(0, 10).split("-");
  return Date.UTC(Number(yearPart), Number(monthPart) - 1, Number(dayPart));
}

/** The length of the consecutive run ending at `endMs` in `days`, or 0 if `endMs` itself is absent. */
function runEndingAt(days: ReadonlySet<number>, endMs: number): number {
  let length = 0;
  let ms = endMs;
  while (days.has(ms)) {
    length += 1;
    ms -= MS_PER_DAY;
  }
  return length;
}

/**
 * Computes the current and best consecutive-day streaks from a set of study
 * activity days. `activityDays` may be unsorted and contain duplicates; days
 * strictly after `today` are dropped (shouldn't happen, but the engine trusts
 * nothing beyond its own input).
 *
 * `best` is the longest consecutive run anywhere in the set. `current` is the
 * run ending at `today`; if `today` itself has no activity yet, it gently
 * falls back to the run ending yesterday (the day isn't over — a streak only
 * breaks after a full missed day). If neither today nor yesterday has
 * activity, `current` is 0.
 */
export function computeStreak(activityDays: readonly string[], today: string): StreakResult {
  const todayMs = utcDayMs(today);
  const days = new Set<number>();
  for (const day of activityDays) {
    const ms = utcDayMs(day);
    if (ms <= todayMs) days.add(ms);
  }

  if (days.size === 0) return { current: 0, best: 0 };

  const sorted = [...days].sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  let previousMs: number | null = null;
  for (const ms of sorted) {
    run = previousMs !== null && ms === previousMs + MS_PER_DAY ? run + 1 : 1;
    best = Math.max(best, run);
    previousMs = ms;
  }

  const current = runEndingAt(days, todayMs) || runEndingAt(days, todayMs - MS_PER_DAY);

  return { current, best };
}
