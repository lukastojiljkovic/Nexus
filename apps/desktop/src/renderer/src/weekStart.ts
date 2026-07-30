import type { WeekStart } from "@nexus/core";

/**
 * Which weekday the calendar's month grid and week view open on. Spelled as
 * weekday names rather than `@nexus/core`'s numeric `WeekStart`, so a value
 * sitting in localStorage stays readable and can never be confused with the
 * Monday-first 0..6 indexing the recurrence engine uses for something else
 * entirely; `toWeekStart` is the one place the two meet.
 */
export type WeekStartPreference = "monday" | "sunday";

const STORAGE_KEY = "nexus.weekStart";

// Ponedeljak is the Serbian norm and stays the default; the setting exists for
// people who read a calendar the other way round (PRD 04 §5).
const DEFAULT_WEEK_START: WeekStartPreference = "monday";

/** Narrowing helper over the stored string — never a cast, so an unknown value falls through to the default. */
function isWeekStartPreference(value: string | null): value is WeekStartPreference {
  return value === "monday" || value === "sunday";
}

/** Reads the stored choice, falling back to the default for anything unrecognized (including nothing stored yet). */
export function readStoredWeekStart(): WeekStartPreference {
  const stored = localStorage.getItem(STORAGE_KEY);
  return isWeekStartPreference(stored) ? stored : DEFAULT_WEEK_START;
}

/** Persists the choice. Unlike the theme and accent there is no document attribute to set — the calendar reads this value, the stylesheet never does. */
export function persistWeekStart(preference: WeekStartPreference): void {
  localStorage.setItem(STORAGE_KEY, preference);
}

/** The layout engine's own form: `Date.getUTCDay()` terms, 1 = Monday, 0 = Sunday. */
export function toWeekStart(preference: WeekStartPreference): WeekStart {
  return preference === "sunday" ? 0 : 1;
}
