/**
 * Local wall-clock reads shared by every main-process date/time computation
 * (STUDY plan sync, NTF scheduler): every "today"/"now" goes through here so
 * the whole main process agrees on the same values, built the same way —
 * deliberately from `getFullYear()/getMonth()/getDate()`/`getHours()`/
 * `getMinutes()`, never the UTC-shifting `toISOString().slice(...)` idiom,
 * which misdates/mistimes the last hours of the day in every positive-UTC-
 * offset timezone (including Belgrade).
 */

/** Today as a bare "YYYY-MM-DD", from the local wall clock. */
export function localToday(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** The current local wall-clock time as "HH:MM" (24-hour) — for quiet-hours/morning-hour comparisons. */
export function localTime(): string {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}
