import { dayUnit, strings } from "./strings.js";

/**
 * Shared bare-calendar-date math for exams (STUDY), reused by StudyPage, the
 * CalendarPage agenda, and the DASH Ispiti widget — so the three surfaces never
 * drift on "how many days until this exam". Mirrors DocumentsPanel/DashboardPage's
 * UTC-midnight day arithmetic exactly: `examDate` is a bare "YYYY-MM-DD" date
 * (a time part, if present, is ignored), parsed and diffed at UTC midnight, while
 * "today" comes from local wall-clock y/m/d fields — so a negative-offset
 * timezone never shifts a day.
 */

const MS_PER_DAY = 86_400_000;

/** UTC-midnight ms for a bare "YYYY-MM-DD" prefix; NaN on unparseable input. */
function utcDayMs(dateKey: string): number {
  const [yearPart, monthPart, dayPart] = dateKey.slice(0, 10).split("-");
  const year = Number(yearPart);
  const month = Number(monthPart);
  const day = Number(dayPart);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return NaN;
  return Date.UTC(year, month - 1, day);
}

/** Whole days from today to `examDate` (negative once the exam date has passed). */
export function daysUntilExam(examDate: string): number {
  const now = new Date();
  const todayMs = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((utcDayMs(examDate) - todayMs) / MS_PER_DAY);
}

/**
 * The local calendar day as a bare "YYYY-MM-DD" key — the same wall-clock
 * y/m/d read `daysUntilExam` uses for "today" (and main's `localToday`), so
 * every study-planner range query agrees with the countdown math.
 */
export function localTodayKey(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/** The bare day key `days` after `dayKey` (negative shifts back) — UTC-midnight math, no timezone/DST drift. */
export function shiftDayKey(dayKey: string, days: number): string {
  const date = new Date(utcDayMs(dayKey) + days * MS_PER_DAY);
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${date.getUTCFullYear()}-${month}-${day}`;
}

/** Exam date for display — "8. jul 2026." in Serbian; raw string on bad input. */
export function formatExamDate(examDate: string): string {
  const date = new Date(examDate.slice(0, 10));
  return Number.isNaN(date.getTime())
    ? examDate
    : new Intl.DateTimeFormat("sr-Latn", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }).format(date);
}

/** Countdown chip text: "danas" / "sutra" / "za N dan(a)", or "prošao" once past. */
export function examCountdownLabel(days: number): string {
  const c = strings.study.countdown;
  if (days < 0) return c.past;
  if (days === 0) return c.today;
  if (days === 1) return c.tomorrow;
  return `${c.future} ${days} ${dayUnit(days, c.unitOne, c.unitMany)}`;
}

/** Chip variant for the countdown: urgent within a day, informational further out, quiet once past. */
export function examCountdownVariant(days: number): "accent" | "data" | "neutral" {
  if (days < 0) return "neutral";
  return days <= 1 ? "accent" : "data";
}
