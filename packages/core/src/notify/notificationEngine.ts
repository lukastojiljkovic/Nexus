/**
 * Pure derive-don't-materialize engine for the NOTIFICATIONS module (NTF piece
 * a1): takes plain arrays of source entities (documents, exams, pre-aggregated
 * study-day activity) plus the caller's clock/settings, and returns the
 * occurrences that are due right now. No clock reads, no `Date.now()` — every
 * date/time involved (`today`, `nowLocalTime`) is an explicit input, mirroring
 * `planEngine.ts`'s idiom exactly, so the same arguments always produce the
 * same output. The desktop main process's scheduler (NTF piece a2) is the
 * caller: it reads the real clock and the source stores once, then calls this
 * function with plain arrays and strings, and records what fired in
 * `@nexus/db`'s `NotificationStore` ledger.
 *
 * Deriving instead of materializing ahead buys three things (the whole point
 * of this design): deleting a source entity simply stops it being derived —
 * nothing to clean up, so the PRD's cleanup contract holds with zero coupling
 * between modules; a clock or timezone change self-heals on the very next
 * check, since nothing stale was ever written; and anything that came due
 * while the app was closed naturally surfaces on the first check after
 * launch (a later digest UX groups these). `NotificationStore`'s `notifications`
 * table is only ever a ledger of what this engine already decided was due —
 * never the source of truth for what IS due.
 *
 * All date math happens at UTC midnight (`Date.UTC(...)`), mirroring
 * `planEngine.ts`'s `utcDayMs`/`utcDateKey` helpers exactly, so a bare date
 * never shifts by a day regardless of the host's timezone. Dates that carry a
 * time part (documents/exams may, per their stores' ISO-8601 columns) are
 * reduced to their bare "YYYY-MM-DD" prefix before any comparison or math.
 */

const MS_PER_DAY = 86_400_000;

/** The three NTF-001..003 source kinds this slice derives from; NTF-006/007 (private notes, security) have no sources yet. */
export type NotificationSource = "document" | "exam" | "study-day";

/** `max` bypasses quiet hours (the PRD's "final warning" exception); everything else is `normal`. */
export type NotificationPriority = "normal" | "max";

/** One due reminder occurrence, ready for `NotificationStore.recordDelivered`. */
export interface NotificationCandidate {
  source: NotificationSource;
  /** Document id / exam id / the bare study date, depending on `source`. */
  entityId: string;
  /** A deterministic per-occurrence key: the offset (documents), "d-1"/"d-0" (exams), or "day" (study days). */
  occurrenceKey: string;
  /** Bare "YYYY-MM-DD" the occurrence belongs to. */
  fireDate: string;
  priority: NotificationPriority;
}

/** A tracked document's reminder-relevant fields (mirrors `DocumentStore`'s `TrackedDocument`). */
export interface DocumentReminderInput {
  id: string;
  expiryDate: string;
  reminderOffsets: readonly number[];
}

/** An exam's reminder-relevant fields (mirrors `ExamStore`'s `Exam`). */
export interface ExamReminderInput {
  id: string;
  examDate: string;
}

/** One local day's planned study activity, pre-aggregated by the caller (mirrors `PlanStore`'s blocks). */
export interface StudyDayReminderInput {
  date: string;
  blockCount: number;
  totalMinutes: number;
}

export interface DeriveNotificationCandidatesInput {
  documents: ReadonlyArray<DocumentReminderInput>;
  exams: ReadonlyArray<ExamReminderInput>;
  studyDays: ReadonlyArray<StudyDayReminderInput>;
  enabledSources: ReadonlyArray<NotificationSource>;
  /** Bare "YYYY-MM-DD", the caller's local today. */
  today: string;
  /** "HH:MM", the caller's local wall-clock time. */
  nowLocalTime: string;
  /** "HH:MM"; every occurrence fires at this local time (default "08:00" upstream, founder decision 2026-07-05). */
  morningHour: string;
}

/** An occurrence before the due-time filter: `NotificationCandidate` plus whether it is still relevant at all. */
interface Occurrence extends NotificationCandidate {
  relevant: boolean;
}

/** UTC-midnight ms for a bare "YYYY-MM-DD" prefix (mirrors `planEngine.ts`'s `utcDayMs`). */
function utcDayMs(dateKey: string): number {
  const [yearPart, monthPart, dayPart] = bareDate(dateKey).split("-");
  return Date.UTC(Number(yearPart), Number(monthPart) - 1, Number(dayPart));
}

/** Formats UTC-midnight ms back into a bare "YYYY-MM-DD" string (mirrors `planEngine.ts`'s `utcDateKey`). */
function utcDateKey(ms: number): string {
  const d = new Date(ms);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** The bare "YYYY-MM-DD" prefix of a date-like string (stores may carry a time part). */
function bareDate(value: string): string {
  return value.slice(0, 10);
}

/**
 * Derives every due notification occurrence across the three sources,
 * deterministically ordered by source, then entity id, then occurrence key.
 * An occurrence is due when it is still relevant to its entity's current
 * state AND either its fire date has already passed (came due while the app
 * was off) or it fires today at/after `morningHour` ("HH:MM" strings compare
 * lexicographically). Sources absent from `enabledSources` contribute
 * nothing. Pure: no clock reads, no mutation of the input.
 */
export function deriveNotificationCandidates(
  input: DeriveNotificationCandidatesInput,
): NotificationCandidate[] {
  const enabled = new Set(input.enabledSources);
  const occurrences: Occurrence[] = [
    ...(enabled.has("document") ? documentOccurrences(input.documents, input.today) : []),
    ...(enabled.has("exam") ? examOccurrences(input.exams, input.today) : []),
    ...(enabled.has("study-day") ? studyDayOccurrences(input.studyDays, input.today) : []),
  ];

  const due = occurrences.filter((occurrence) =>
    isDue(occurrence, input.today, input.nowLocalTime, input.morningHour),
  );

  due.sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : 0));

  return due.map(({ relevant: _relevant, ...candidate }) => candidate);
}

/**
 * One occurrence per (document, offset): fireDate = expiryDate - offset days,
 * keyed by the offset itself. Relevant while `today <= expiryDate`. Priority
 * is `max` for the smallest offset in the document's own ladder (the PRD's
 * "final warning" quiet-hours exception), `normal` for the rest.
 */
function documentOccurrences(
  documents: ReadonlyArray<DocumentReminderInput>,
  today: string,
): Occurrence[] {
  const occurrences: Occurrence[] = [];
  for (const document of documents) {
    const expiryDateKey = bareDate(document.expiryDate);
    const expiryMs = utcDayMs(expiryDateKey);
    const minOffset =
      document.reminderOffsets.length > 0 ? Math.min(...document.reminderOffsets) : null;
    const relevant = today <= expiryDateKey;

    for (const offset of document.reminderOffsets) {
      occurrences.push({
        source: "document",
        entityId: document.id,
        occurrenceKey: String(offset),
        fireDate: utcDateKey(expiryMs - offset * MS_PER_DAY),
        priority: offset === minOffset ? "max" : "normal",
        relevant,
      });
    }
  }
  return occurrences;
}

/**
 * Two occurrences per exam: day-before ("d-1", fireDate = examDate - 1 day)
 * and morning-of ("d-0", fireDate = examDate). Both are relevant while
 * `today <= examDate` — a missed day-before reminder still surfaces on exam
 * day itself. Priority is always `normal`.
 */
function examOccurrences(exams: ReadonlyArray<ExamReminderInput>, today: string): Occurrence[] {
  const occurrences: Occurrence[] = [];
  for (const exam of exams) {
    const examDateKey = bareDate(exam.examDate);
    const examMs = utcDayMs(examDateKey);
    const relevant = today <= examDateKey;

    occurrences.push({
      source: "exam",
      entityId: exam.id,
      occurrenceKey: "d-1",
      fireDate: utcDateKey(examMs - MS_PER_DAY),
      priority: "normal",
      relevant,
    });
    occurrences.push({
      source: "exam",
      entityId: exam.id,
      occurrenceKey: "d-0",
      fireDate: examDateKey,
      priority: "normal",
      relevant,
    });
  }
  return occurrences;
}

/**
 * One occurrence per provided study day: fireDate = date, key "day". Relevant
 * only while `today === date` — a stale nudge from a prior day is noise, not
 * information, so (unlike documents/exams) there is no catch-up here.
 */
function studyDayOccurrences(
  studyDays: ReadonlyArray<StudyDayReminderInput>,
  today: string,
): Occurrence[] {
  return studyDays.map((day) => ({
    source: "study-day",
    entityId: day.date,
    occurrenceKey: "day",
    fireDate: day.date,
    priority: "normal",
    relevant: today === day.date,
  }));
}

/** Due = relevant AND (fireDate already past — missed while off — OR firing today at/after the morning hour). */
function isDue(
  occurrence: Occurrence,
  today: string,
  nowLocalTime: string,
  morningHour: string,
): boolean {
  if (!occurrence.relevant) return false;
  if (occurrence.fireDate < today) return true;
  return occurrence.fireDate === today && nowLocalTime >= morningHour;
}

/** Deterministic sort key: source, then entity id, then occurrence key (plain string ordering). */
function sortKey(occurrence: NotificationCandidate): string {
  return `${occurrence.source} ${occurrence.entityId} ${occurrence.occurrenceKey}`;
}
