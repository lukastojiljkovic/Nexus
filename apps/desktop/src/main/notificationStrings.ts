import type { NotificationSource } from "@nexus/core";

/**
 * Serbian copy for OS notifications, fired only from the main process (NTF
 * piece a2). The main process cannot import the renderer's `strings.ts` — a
 * separate bundle, browser-only build — so this is the single, centralized
 * main-side counterpart. It produces exactly the text snapshot recorded by
 * `NotificationStore.recordDelivered` and shown by an OS `Notification`; the
 * later bell/center UI (NTF piece a3) keeps using the renderer's own
 * `strings.ts` for everything it renders itself. Sentence case throughout, no
 * exclamation marks (the app's tone: informative, never alarming).
 */

/** One notification's exact text snapshot. */
export interface NotificationCopy {
  title: string;
  body: string;
}

const EXAM_TYPE_LABELS: Record<"pismeni" | "usmeni" | "kolokvijum", string> = {
  pismeni: "Pismeni",
  usmeni: "Usmeni",
  kolokvijum: "Kolokvijum",
};

const MS_PER_DAY = 86_400_000;
const MINUTES_PER_DAY = 1_440;
const MINUTES_PER_HOUR = 60;

/** UTC-midnight ms for a bare "YYYY-MM-DD" prefix (mirrors the engine's own `utcDayMs`). */
function utcDayMs(dateKey: string): number {
  const [yearPart, monthPart, dayPart] = dateKey.slice(0, 10).split("-");
  return Date.UTC(Number(yearPart), Number(monthPart) - 1, Number(dayPart));
}

/** Whole days from `today` to `dateKey` (both bare "YYYY-MM-DD"). */
function daysUntil(today: string, dateKey: string): number {
  return Math.round((utcDayMs(dateKey) - utcDayMs(today)) / MS_PER_DAY);
}

/** "YYYY-MM-DD" -> "DD.MM.YYYY." (Serbian date punctuation). */
function formatDate(dateKey: string): string {
  const [year, month, day] = dateKey.slice(0, 10).split("-");
  return `${day}.${month}.${year}.`;
}

/**
 * Serbian 1 / 2-4 / 5+ numeral agreement. The renderer's `strings.ts` has a
 * simpler 2-way `dayUnit` (singular vs. "many") that happens to be correct
 * for "dan/dana" because that word's paucal and plural forms coincide; other
 * nouns here (documents, reminders) do not coincide, so this is the full
 * 3-way rule. Main and renderer never share a module, so this is kept in
 * sync with `dayUnit`'s singular rule by hand, not by import.
 */
function pluralize(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/** "dan"/"dana" agreement — the renderer's `dayUnit` rule, reused verbatim (the two forms coincide for this word). */
function dayUnit(count: number): string {
  return count % 10 === 1 && count % 100 !== 11 ? "dan" : "dana";
}

/**
 * Document expiry reminder copy. `today`/`expiryDate` are bare "YYYY-MM-DD".
 * `isFinalWarning` is the candidate's `priority === "max"` — the ladder's
 * smallest offset, the PRD's quiet-hours exception — and gets its own title.
 */
export function documentNotificationCopy(
  label: string,
  expiryDate: string,
  today: string,
  isFinalWarning: boolean,
): NotificationCopy {
  const title = isFinalWarning ? "Poslednja opomena: dokument ističe" : "Dokument uskoro ističe";
  const days = daysUntil(today, expiryDate);
  const dayPhrase = days <= 0 ? "ističe danas" : `ističe za ${days} ${dayUnit(days)}`;
  return { title, body: `„${label}“ ${dayPhrase} (${formatDate(expiryDate)})` };
}

/** Exam reminder copy: day-before ("d-1") vs. morning-of ("d-0"). */
export function examNotificationCopy(
  subjectName: string,
  examType: "pismeni" | "usmeni" | "kolokvijum",
  occurrenceKey: "d-1" | "d-0",
): NotificationCopy {
  const title = occurrenceKey === "d-0" ? "Ispit je danas" : "Ispit sutra";
  return { title, body: `${subjectName} — ${EXAM_TYPE_LABELS[examType]}` };
}

/**
 * A non-zero lead time as the user set it: "10 min ranije", "1 h ranije",
 * "2 dana ranije". Whole days and whole hours get their own unit so a day-long
 * lead never reads as "1440 min". The renderer's event form spells the very
 * same ladder for its chips — kept in sync by hand, like `dayUnit` above, since
 * main and renderer never share a module.
 */
function leadPhrase(offsetMinutes: number): string {
  if (offsetMinutes % MINUTES_PER_DAY === 0) {
    const days = offsetMinutes / MINUTES_PER_DAY;
    return `${days} ${dayUnit(days)} ranije`;
  }
  if (offsetMinutes % MINUTES_PER_HOUR === 0) {
    return `${offsetMinutes / MINUTES_PER_HOUR} h ranije`;
  }
  return `${offsetMinutes} min ranije`;
}

/**
 * Event reminder copy (CAL-006). `occurrenceDate`/`today` are bare
 * "YYYY-MM-DD" — for a recurring series that is the occurrence's own day, not
 * the master's — and `startTime` is its "HH:MM" wall-clock start, or null for
 * an all-day event.
 *
 * The body states when the event actually starts rather than how long is left:
 * a reminder that came due while the app was closed surfaces on the next check,
 * so anything phrased as a countdown would be a lie exactly when it matters.
 * The lead time is still named — it is what the user set, and it is what tells
 * two reminders for the SAME occurrence apart — but only for a timed one: an
 * all-day occurrence's sub-day offsets all collapse onto its own morning
 * (see the engine), so "10 min ranije" there would describe nothing.
 */
export function eventNotificationCopy(
  title: string,
  occurrenceDate: string,
  today: string,
  startTime: string | null,
  offsetMinutes: number,
): NotificationCopy {
  const days = daysUntil(today, occurrenceDate);
  const dayPhrase = days === 0 ? "danas" : days === 1 ? "sutra" : formatDate(occurrenceDate);

  if (startTime === null) {
    return { title: `Događaj: ${title}`, body: `Ceo dan · ${dayPhrase}` };
  }
  const startPhrase = days === 0 ? `Počinje u ${startTime}` : `Počinje ${dayPhrase} u ${startTime}`;
  return {
    title: `Događaj: ${title}`,
    body: offsetMinutes > 0 ? `${startPhrase} · ${leadPhrase(offsetMinutes)}` : startPhrase,
  };
}

/** Today's study-day reminder copy: how many blocks are planned and their total length. */
export function studyDayNotificationCopy(blockCount: number, totalMinutes: number): NotificationCopy {
  const blockPhrase = pluralize(blockCount, "blok", "bloka", "blokova");
  return { title: "Učenje danas", body: `${blockCount} ${blockPhrase} · ${totalMinutes} min` };
}

/** Per-source counts for the grouped digest, in the fixed order documents/exams/study-days/events/tasks. */
export interface DigestCounts {
  document: number;
  exam: number;
  "study-day": number;
  event: number;
  /** ADR-028; `groupedDigestCopy` gets its Serbian phrase in the next slice, with the rest of the task copy. */
  task: number;
}

/**
 * Grouped-digest copy for a batch of more than 3 simultaneous notifications
 * (the storm guard): one title with the total, one body listing each
 * contributing source's count. A source with a zero count is omitted.
 */
export function groupedDigestCopy(total: number, counts: DigestCounts): NotificationCopy {
  const title = `Nexus — ${total} ${pluralize(total, "podsetnik", "podsetnika", "podsetnika")}`;
  const parts: string[] = [];
  if (counts.document > 0) {
    parts.push(`${counts.document} ${pluralize(counts.document, "dokument", "dokumenta", "dokumenata")}`);
  }
  if (counts.exam > 0) {
    parts.push(`${counts.exam} ${pluralize(counts.exam, "ispit", "ispita", "ispita")}`);
  }
  if (counts["study-day"] > 0) {
    parts.push(`${counts["study-day"]} ${pluralize(counts["study-day"], "učenje", "učenja", "učenja")}`);
  }
  if (counts.event > 0) {
    parts.push(`${counts.event} ${pluralize(counts.event, "događaj", "događaja", "događaja")}`);
  }
  return { title, body: parts.join(" · ") };
}

/** An empty per-source counter, keyed the same way as `@nexus/core`'s `NotificationSource`. */
export function emptyDigestCounts(): Record<NotificationSource, number> {
  return { document: 0, exam: 0, "study-day": 0, event: 0, task: 0 };
}
