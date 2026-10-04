import type { ExamType, StudyLogDay } from "../../shared/ipc.js";
import { formatDurationMinutes } from "./focusFormat.js";
import { countUnit, strings } from "./strings.js";

/**
 * Pure text helpers for „Dnevnik učenja" — one subject's day-by-day study log
 * (STUDY-014). Mirrors focusFormat.ts/examDates.ts's small-pure-module idiom:
 * the page decides what to fetch and when, this decides only what a fetched day
 * READS as, so the wording is testable without mounting anything.
 *
 * The day heading itself is deliberately not here: a log day is a bare
 * "YYYY-MM-DD", which `examDates.formatExamDate` already renders in the active
 * locale ("8. jul 2026." or "8 July 2026"), and a second Intl formatter
 * printing the same value in a second way is exactly the drift these shared
 * modules exist to prevent.
 */

/**
 * How many days one page of the log covers, and therefore how much „Prikaži
 * još" adds (ADR-039 §4's honest-bound recipe). Unlike „Završeno", this bound
 * is a QUERY bound rather than a DOM slice — a subject's history is not in
 * memory, and reading years of it to draw sixty rows is the cost the bound
 * exists to refuse.
 */
export const STUDY_LOG_WINDOW_DAYS = 60;

/**
 * The compact facts of one log day, in reading order: reviews, focus time,
 * planned minutes. Each is present only when it happened, so a day never says
 * "0" about anything — the row exists precisely because something on it did
 * not. The caller joins them (" · ") and renders any exam of the day as its own
 * chip, since a milestone is not a quantity.
 */
export function studyLogFacts(day: StudyLogDay): string[] {
  const copy = strings.study.log;
  const facts: string[] = [];
  if (day.reviews > 0) {
    facts.push(
      `${day.reviews} ${countUnit(day.reviews, copy.reviewOne, copy.reviewFew, copy.reviewMany)}`,
    );
  }
  if (day.focusMinutes > 0) {
    facts.push(`${formatDurationMinutes(day.focusMinutes)} ${copy.focusSuffix}`);
  }
  if (day.plannedMinutes > 0) {
    facts.push(`${copy.planPrefix} ${formatDurationMinutes(day.plannedMinutes)}`);
  }
  return facts;
}

/**
 * The exam chips a day carries — „Ispit: Pismeni", one per exam, in the order
 * the store returned them (exam date, then id), each keeping its id so the
 * caller has a stable React key. An id the page's own exam list cannot resolve
 * still gets its chip, labelled „Ispit" alone: the exam fell on that day
 * whether or not the list has caught up with it, and dropping the milestone
 * would be the worse lie.
 */
export function studyLogExamLabels(
  examIds: readonly string[],
  examTypesById: ReadonlyMap<string, ExamType>,
): Array<{ id: string; label: string }> {
  const copy = strings.study.log;
  return examIds.map((id) => {
    const examType = examTypesById.get(id);
    return {
      id,
      label:
        examType === undefined
          ? copy.examTag
          : `${copy.examTag}: ${strings.study.examType[examType]}`,
    };
  });
}
