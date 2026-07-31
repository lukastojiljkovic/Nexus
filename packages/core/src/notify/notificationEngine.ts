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
 *
 * Four of the five sources are day-granular: they fire at the profile's
 * `morningHour` on a bare `fireDate`. Task reminders (ADR-028) are the newest
 * of those four and deliberately the document model, days-before-due and all,
 * because a task's due date is itself a bare day. Event reminders (CAL-006,
 * ADR-025) are the one exception — "15 minutes before" is meaningless rounded
 * to a day — so a timed occurrence carries a fire INSTANT instead, and the
 * same UTC math is simply carried down to the minute. Both live in one
 * `Occurrence` shape and one `isDue`, so the day-granular sources' behaviour
 * is untouched.
 */

const MS_PER_DAY = 86_400_000;
const MS_PER_MINUTE = 60_000;
const MINUTES_PER_DAY = 1_440;

/**
 * The source kinds a notification can carry. The first five are what this
 * engine DERIVES (NTF-001..003 / CAL-006 / ADR-028) — each has source entities
 * to look at. `"security"` (NTF-007) is deliberately not one of them: a wrong
 * passcode burst, a passcode change, a Recovery Kit reissue and an account
 * deletion are EVENTS, not states, so there is nothing left on disk to
 * re-derive them from a minute later. The desktop main process records those at
 * the moment they happen, which is why they never appear in any input here —
 * and why they carry the always-on exemption below instead of an appetite
 * toggle.
 */
export type NotificationSource = "document" | "exam" | "study-day" | "event" | "task" | "security";

/** `max` bypasses quiet hours (the PRD's "final warning" exception); everything else is `normal`. */
export type NotificationPriority = "normal" | "max";

/**
 * Sources no user preference may silence (NTF-007). A security event is the one
 * thing the app must be able to say when the user did not ask to hear it: it is
 * exactly the moment where "you were not told" is the failure. So these are
 * exempt from BOTH filtering gates — quiet hours and the appetite
 * (`enabledSources`) — and the settings UI renders their toggle forced on and
 * disabled rather than offering a switch that would have to be ignored.
 */
export const ALWAYS_ON_SOURCES: readonly NotificationSource[] = ["security"];

/** Whether a source is exempt from every suppression rule (see `ALWAYS_ON_SOURCES`). */
export function isAlwaysOnSource(source: NotificationSource): boolean {
  return ALWAYS_ON_SOURCES.includes(source);
}

/** What the caller knows about the delivery moment: this profile's appetite, and whether quiet hours are in force right now. */
export interface DeliveryGate {
  enabledSources: readonly NotificationSource[];
  withinQuietHours: boolean;
}

/**
 * The whole suppression contract in one predicate — whether something that is
 * due may actually be put in front of the user right now.
 *
 * Three rules, in order: an always-on source is delivered unconditionally; an
 * appetite the profile switched off suppresses its source; and quiet hours
 * suppress everything but a `max`-priority occurrence (the PRD's "final
 * warning" exception, an expiring document's last reminder).
 *
 * Kept here rather than in the scheduler because it is a rule, not a mechanism:
 * the derivation above already honours `enabledSources`, so re-checking it
 * costs nothing and makes this total — one function that can be handed any
 * candidate, derived or recorded, and always answers correctly.
 */
export function isDeliverable(
  candidate: { source: NotificationSource; priority: NotificationPriority },
  gate: DeliveryGate,
): boolean {
  if (isAlwaysOnSource(candidate.source)) return true;
  if (!gate.enabledSources.includes(candidate.source)) return false;
  return candidate.priority === "max" || !gate.withinQuietHours;
}

/** One due reminder occurrence, ready for `NotificationStore.recordDelivered`. */
export interface NotificationCandidate {
  source: NotificationSource;
  /** Document id / exam id / the bare study date, depending on `source`. */
  entityId: string;
  /** A deterministic per-occurrence key: the offset (documents), "d-1"/"d-0" (exams), "day" (study days), or "<date> <offset>" — the occurrence's own date for an event, the due date for a task. */
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

/**
 * One event occurrence's reminder-relevant fields — for a recurring series the
 * CALLER (main's scheduler) expands the master and passes one row per
 * occurrence; `occurrenceDate` is that occurrence's own bare date (a one-off
 * passes its start date).
 */
export interface EventReminderInput {
  id: string;
  /** Bare "YYYY-MM-DD". */
  occurrenceDate: string;
  /** Wall-clock "HH:MM" start on that date, or null for an all-day event. */
  startTime: string | null;
  /** Whole minutes before the start (mirrors `EventStore`'s `reminderOffsets`). */
  reminderOffsets: readonly number[];
}

/**
 * A dated task's reminder-relevant fields. The caller passes only tasks that
 * are not done, carry a bare-date due date and a non-empty ladder.
 */
export interface TaskReminderInput {
  id: string;
  dueDate: string;
  reminderOffsets: readonly number[];
}

export interface DeriveNotificationCandidatesInput {
  documents: ReadonlyArray<DocumentReminderInput>;
  exams: ReadonlyArray<ExamReminderInput>;
  events: ReadonlyArray<EventReminderInput>;
  studyDays: ReadonlyArray<StudyDayReminderInput>;
  tasks: ReadonlyArray<TaskReminderInput>;
  enabledSources: ReadonlyArray<NotificationSource>;
  /** Bare "YYYY-MM-DD", the caller's local today. */
  today: string;
  /** "HH:MM", the caller's local wall-clock time. */
  nowLocalTime: string;
  /** "HH:MM"; every occurrence fires at this local time (default "08:00" upstream, founder decision 2026-07-05). */
  morningHour: string;
}

/**
 * An occurrence before the due-time filter: `NotificationCandidate`, whether it
 * is still relevant at all, and — for the minute-granular source only — the
 * exact local instant it fires at ("YYYY-MM-DDTHH:MM"). `null` means
 * day-granular: fire at `morningHour` on `fireDate`, the model the other three
 * sources speak.
 */
interface Occurrence extends NotificationCandidate {
  relevant: boolean;
  fireInstant: string | null;
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

/** The same UTC-midnight math as `utcDayMs`, carried down to the minute by an "HH:MM" wall-clock time. */
function utcMinuteMs(dateKey: string, time: string): number {
  const [hourPart, minutePart] = time.split(":");
  return utcDayMs(dateKey) + (Number(hourPart) * 60 + Number(minutePart)) * MS_PER_MINUTE;
}

/**
 * Formats UTC ms back into a fixed-width local wall-clock instant,
 * "YYYY-MM-DDTHH:MM". Fixed width is the whole point: two of these compare
 * lexicographically exactly as the instants they denote compare, which is what
 * lets `isDue` stay a string comparison like every other branch.
 */
function utcInstantKey(ms: number): string {
  const d = new Date(ms);
  const hour = String(d.getUTCHours()).padStart(2, "0");
  const minute = String(d.getUTCMinutes()).padStart(2, "0");
  return `${utcDateKey(ms)}T${hour}:${minute}`;
}

/**
 * Derives every due notification occurrence across the five sources,
 * deterministically ordered by source, then entity id, then occurrence key.
 * An occurrence is due when it is still relevant to its entity's current
 * state AND its fire moment has arrived — for the four day-granular sources
 * that means its fire date has already passed (came due while the app was off)
 * or it fires today at/after `morningHour`; for a timed event reminder it
 * means its fire instant is at or before now ("HH:MM" and the fixed-width
 * instants both compare lexicographically). Sources absent from
 * `enabledSources` contribute nothing. Pure: no clock reads, no mutation of
 * the input.
 */
export function deriveNotificationCandidates(
  input: DeriveNotificationCandidatesInput,
): NotificationCandidate[] {
  const enabled = new Set(input.enabledSources);
  const now = `${input.today}T${input.nowLocalTime}`;
  const occurrences: Occurrence[] = [
    ...(enabled.has("document") ? documentOccurrences(input.documents, input.today) : []),
    ...(enabled.has("exam") ? examOccurrences(input.exams, input.today) : []),
    ...(enabled.has("study-day") ? studyDayOccurrences(input.studyDays, input.today) : []),
    ...(enabled.has("event") ? eventOccurrences(input.events, input.today, now) : []),
    ...(enabled.has("task") ? taskOccurrences(input.tasks, input.today) : []),
  ];

  const due = occurrences.filter((occurrence) =>
    isDue(occurrence, input.today, input.nowLocalTime, input.morningHour, now),
  );

  due.sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : 0));

  return due.map(({ relevant: _relevant, fireInstant: _fireInstant, ...candidate }) => candidate);
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
        fireInstant: null,
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
      fireInstant: null,
    });
    occurrences.push({
      source: "exam",
      entityId: exam.id,
      occurrenceKey: "d-0",
      fireDate: examDateKey,
      priority: "normal",
      relevant,
      fireInstant: null,
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
    fireInstant: null,
  }));
}

/**
 * One occurrence per (event row, offset), keyed by the occurrence's own date
 * and that offset — a recurring master arrives already expanded, one row per
 * occurrence, so the date is what tells two occurrences of one series apart.
 * Priority is always `normal`: an event reminder is never the PRD's
 * quiet-hours "final warning" exception, which belongs to expiring documents.
 *
 * A **timed** occurrence is minute-granular: it fires `offset` minutes before
 * its start instant and stays relevant until that start — so one missed while
 * the app was closed still fires afterwards (the occurrence has not happened
 * yet), and a lead time longer than the start's time of day simply lands on an
 * earlier day, which is why `fireDate` is read off the fire instant rather
 * than the occurrence.
 *
 * An **all-day** occurrence has no start instant to count back from, so it
 * degrades to the day-granular model the other three sources speak: whole days
 * back (a partial day rounds down to none), firing at `morningHour`, relevant
 * for the whole of its own day.
 */
function eventOccurrences(
  events: ReadonlyArray<EventReminderInput>,
  today: string,
  now: string,
): Occurrence[] {
  const occurrences: Occurrence[] = [];
  for (const event of events) {
    const occurrenceDate = bareDate(event.occurrenceDate);
    const startTime = event.startTime;
    const timed = startTime !== null;
    const relevant = timed ? now <= `${occurrenceDate}T${startTime}` : today <= occurrenceDate;
    const startMs = timed ? utcMinuteMs(occurrenceDate, startTime) : 0;

    for (const offset of event.reminderOffsets) {
      const fireInstant = timed ? utcInstantKey(startMs - offset * MS_PER_MINUTE) : null;
      occurrences.push({
        source: "event",
        entityId: event.id,
        occurrenceKey: `${occurrenceDate} ${offset}`,
        fireDate:
          fireInstant !== null
            ? bareDate(fireInstant)
            : utcDateKey(utcDayMs(occurrenceDate) - Math.floor(offset / MINUTES_PER_DAY) * MS_PER_DAY),
        priority: "normal",
        relevant,
        fireInstant,
      });
    }
  }
  return occurrences;
}

/**
 * One occurrence per (task, offset): fireDate = dueDate - offset days, keyed by
 * the task's own due date and that offset. The due date is IN the key
 * deliberately: a recurring task advances in place (ADR-024), so each advance
 * re-keys the next occurrence's reminders for free. Priority is always
 * `normal` — the PRD's quiet-hours "final warning" exception belongs to
 * expiring documents, where the deadline is external and unmovable.
 *
 * Relevant while `today <= dueDate`; the caller has already filtered out done
 * tasks (see `TaskReminderInput`). Catch-up is therefore bounded by the due
 * date itself: a reminder missed while the app was closed still fires, but
 * only up to the day the task is due. Past that, an undone task is
 * OVERDUE-nudge territory — a different occurrence type, on its own cadence,
 * deliberately not derived here.
 */
function taskOccurrences(
  tasks: ReadonlyArray<TaskReminderInput>,
  today: string,
): Occurrence[] {
  const occurrences: Occurrence[] = [];
  for (const task of tasks) {
    const dueDateKey = bareDate(task.dueDate);
    const dueMs = utcDayMs(dueDateKey);
    const relevant = today <= dueDateKey;

    for (const offset of task.reminderOffsets) {
      occurrences.push({
        source: "task",
        entityId: task.id,
        occurrenceKey: `${dueDateKey} ${offset}`,
        fireDate: utcDateKey(dueMs - offset * MS_PER_DAY),
        priority: "normal",
        relevant,
        fireInstant: null,
      });
    }
  }
  return occurrences;
}

/**
 * Due = relevant AND its fire moment has arrived. A minute-granular occurrence
 * (an event reminder) compares its fire instant against `now`; a day-granular
 * one is due once its fire date is past — missed while the app was off — or
 * once it is today and the morning hour has come.
 */
function isDue(
  occurrence: Occurrence,
  today: string,
  nowLocalTime: string,
  morningHour: string,
  now: string,
): boolean {
  if (!occurrence.relevant) return false;
  if (occurrence.fireInstant !== null) return occurrence.fireInstant <= now;
  if (occurrence.fireDate < today) return true;
  return occurrence.fireDate === today && nowLocalTime >= morningHour;
}

/** Deterministic sort key: source, then entity id, then occurrence key (plain string ordering). */
function sortKey(occurrence: NotificationCandidate): string {
  return `${occurrence.source} ${occurrence.entityId} ${occurrence.occurrenceKey}`;
}
