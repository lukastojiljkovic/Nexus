import {
  ageAtOccurrence,
  birthdayOccurrencesInRange,
  isValidDayKey,
  occurrenceDatesInRange,
  shiftDayKey,
} from "@nexus/core";
import type {
  CalendarOverlayEvent,
  Event,
  Exam,
  FinUpcomingRenewal,
  Person,
  StudyBlockWithExam,
  Subject,
  Task,
} from "../../shared/ipc.js";

/**
 * Shared calendar source merge (ADR-020). Every calendar surface — the month
 * grid, the agenda — reads the same `CalendarItem[]` stream, built here once
 * from the four raw row sources. `@nexus/core`'s calendar-grid math throws a
 * `TypeError` on a malformed day key, so this layer is the single place that
 * validates and normalizes a row's day key(s) before anything downstream ever
 * sees it.
 *
 * It is also where a recurring event becomes visible (ADR-024). A series is one
 * stored master row; the calendar expands it here into one item per occurrence
 * in the queried range, each a day-shifted copy of the master carrying the
 * master itself alongside. Everything downstream — all four views, the agenda,
 * the drag handlers, the scope dialog — therefore sees occurrences without
 * knowing they are virtual.
 *
 * The range bounds **only that expansion**. Every other row (a one-off event, a
 * task, an exam, a study block) flows through untouched however far outside the
 * range it falls, exactly as before recurrence existed — a calendar surface that
 * showed everything yesterday still shows everything today.
 *
 * Birthdays (ADR-026) are the second range-bounded source, and for the same
 * reason: a person is one stored row carrying a yearless (month, day), so the
 * range is what says which years to celebrate. Unlike an event, a person has no
 * "one-off" reading to fall back on — outside a usable range they simply do not
 * appear.
 */

export type CalendarSource =
  | "events"
  | "tasks"
  | "exams"
  | "blocks"
  | "birthdays"
  | "overlay"
  | "subscriptions";
/**
 * Chip order — and, because `persistSources` writes this order, the stored
 * format's order too. New sources are APPENDED rather than slotted in beside a
 * related one: every previously stored toggle set then still parses to exactly
 * the sources it named. "overlay" (CAL-005 / ADR-058: the other profile's
 * events) is the CAL-007 precedent's second application: appended, so a
 * profile that stored its toggles before it existed keeps it OFF, while a
 * fresh profile — nothing stored, `readStoredSources`' all-on default — starts
 * it ON.
 */
export const CALENDAR_SOURCES: readonly CalendarSource[] = [
  "events",
  "tasks",
  "exams",
  "blocks",
  "birthdays",
  "overlay",
  // FIN slice d: the renewals a subscription's rule places. Appended, on the
  // CAL-007 precedent the „overlay" comment states — a profile that stored its
  // toggles before this source existed keeps it OFF, while a fresh profile
  // starts it ON.
  "subscriptions",
];

const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

interface CalendarItemBase {
  /** Unique across sources — the row id is only unique within its own table. */
  readonly id: string;
  readonly source: CalendarSource;
  readonly startKey: string;
  /** === startKey unless a multi-day event. */
  readonly endKey: string;
  /** Minutes from midnight, or null for a day-granular item (all-day event, task, exam, block). */
  readonly startMinutes: number | null;
  readonly endMinutes: number | null;
  /** Agenda ordering key: the raw `startAt` for a timed event, the bare day otherwise. */
  readonly sortKey: string;
}

/**
 * One virtual occurrence's own identity (ADR-024): the bare day it falls on and
 * the stored master it was expanded from. The item's own `event` is a day-shifted
 * copy of that master, so the views render the occurrence while the series
 * operations — `addEventRecurrenceExdate`, `splitEventRecurrence`, an edit of
 * the whole series — still have the row they must actually address.
 */
export interface EventOccurrence {
  readonly date: string;
  readonly master: Event;
}

export type CalendarItem = CalendarItemBase &
  (
    | { kind: "event"; event: Event; occurrence: EventOccurrence | null }
    | { kind: "task"; task: Task }
    | { kind: "exam"; exam: Exam; subject: Subject }
    | { kind: "block"; block: StudyBlockWithExam; exam: Exam; subject: Subject }
    /** One year's celebration of a person's date (ADR-026); `age` is null whenever the year is unknown. */
    | { kind: "birthday"; person: Person; age: number | null }
    /**
     * One occurrence of the OTHER profile's calendar (CAL-005 / ADR-058 §5) —
     * a read-only guest: unopenable (its click opens the origin popover, never
     * an editor), never draggable, never resizable. Its own kind, so every
     * switch over items is forced to decide what a guest row may do there.
     */
    | { kind: "foreign"; foreign: CalendarOverlayEvent }
    /**
     * One renewal a subscription's RULE places on a day (FIN slice d) — read
     * from the schedule, never from a transaction, which is the whole of "a
     * charge that has not happened is not a row". READ-ONLY here, like the study
     * blocks in the agenda: its click opens the Finansije page, it is never
     * draggable and never resizable, and its own kind is what forces every
     * switch over items to decide what it may do.
     */
    | { kind: "subscription"; renewal: FinUpcomingRenewal }
  );

export interface CalendarSourceRows {
  readonly events: readonly Event[];
  readonly tasks: readonly Task[];
  readonly exams: readonly Exam[];
  readonly blocks: readonly StudyBlockWithExam[];
  readonly subjects: readonly Subject[];
  readonly people: readonly Person[];
  /** The other profile's events for the current range (CAL-005), already expanded and minimized by main; empty while the chip is off or the account has one profile. */
  readonly overlay: readonly CalendarOverlayEvent[];
  /**
   * The renewals this profile's subscriptions place in the current range (FIN
   * slice d), already expanded from their rules by main — the same arrangement
   * `overlay` uses, and for the same reason: the expansion is a store read
   * (`FinRecurringStore.upcoming`), so this builder only derives keys.
   */
  readonly renewals: readonly FinUpcomingRenewal[];
}

/** The window a recurring master is expanded over — inclusive bare day keys. */
export interface CalendarRange {
  readonly from: string;
  readonly to: string;
}

function isDayKey(key: string): boolean {
  return DAY_KEY_RE.test(key);
}

const MS_PER_DAY = 86_400_000;

/** Whole-day delta between two bare day keys, UTC-midnight math (no timezone/DST drift). */
export function daysBetweenKeys(fromKey: string, toKey: string): number {
  const from = Date.UTC(
    Number(fromKey.slice(0, 4)),
    Number(fromKey.slice(5, 7)) - 1,
    Number(fromKey.slice(8, 10)),
  );
  const to = Date.UTC(
    Number(toKey.slice(0, 4)),
    Number(toKey.slice(5, 7)) - 1,
    Number(toKey.slice(8, 10)),
  );
  return Math.round((to - from) / MS_PER_DAY);
}

/** Minutes-from-midnight for an "HH:MM" fragment; null (never NaN) on anything unparseable. */
function parseMinutes(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  const hoursPart = match?.[1];
  const minutesPart = match?.[2];
  if (hoursPart === undefined || minutesPart === undefined) return null;
  const hours = Number(hoursPart);
  const minutes = Number(minutesPart);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** One event row (a one-off, or one occurrence of a series) as a calendar item; null when its start is not a usable day. */
function eventItem(event: Event, occurrence: EventOccurrence | null): CalendarItem | null {
  const startKey = event.startAt.slice(0, 10);
  if (!isDayKey(startKey)) return null;

  // A bad/missing endAt, or one that lands before startAt, collapses to a
  // single-day span rather than feeding a negative range into the grid math.
  let endKey = event.endAt ? event.endAt.slice(0, 10) : startKey;
  if (!isDayKey(endKey) || endKey < startKey) endKey = startKey;

  let startMinutes: number | null = null;
  let endMinutes: number | null = null;
  if (!event.allDay) {
    startMinutes = parseMinutes(event.startAt.slice(11, 16));
    if (event.endAt && event.endAt.slice(0, 10) === startKey) {
      endMinutes = parseMinutes(event.endAt.slice(11, 16));
    }
  }

  return {
    // Occurrences of one master share its row id, so the day is what separates
    // them; a one-off keeps the id it has always had.
    id: occurrence === null ? `event-${event.id}` : `event-${event.id}@${occurrence.date}`,
    source: "events",
    kind: "event",
    event,
    occurrence,
    startKey,
    endKey,
    startMinutes,
    endMinutes,
    sortKey: event.allDay ? startKey : event.startAt,
  };
}

/**
 * The master moved `delta` whole days: same time of day, same duration. Both
 * endpoints shift together, which is what keeps a multi-day series' occurrences
 * as long as the master — the day parts move, the "T14:30" tails do not.
 */
function shiftEventDays(event: Event, delta: number): Event {
  const shifted: Event = {
    ...event,
    startAt: shiftDayKey(event.startAt.slice(0, 10), delta) + event.startAt.slice(10),
  };
  if (event.endAt !== null && isValidDayKey(event.endAt.slice(0, 10))) {
    shifted.endAt = shiftDayKey(event.endAt.slice(0, 10), delta) + event.endAt.slice(10);
  }
  return shifted;
}

function buildEventItems(events: readonly Event[], range: CalendarRange): CalendarItem[] {
  const items: CalendarItem[] = [];
  // Bounds that `occurrenceDatesInRange` would throw on disable expansion
  // altogether rather than making every ruled event disappear: the master is
  // still shown, as the one-off it looks like. Unreachable from the pages,
  // which derive the range from their own (already valid) anchor day.
  const expandable = isValidDayKey(range.from) && isValidDayKey(range.to);

  for (const event of events) {
    const anchor = event.startAt.slice(0, 10);
    if (event.recurrence === null || !expandable || !isValidDayKey(anchor)) {
      const item = eventItem(event, null);
      if (item !== null) items.push(item);
      continue;
    }

    const exdates = new Set(event.recurrenceExdates);
    for (const date of occurrenceDatesInRange(event.recurrence, anchor, range, exdates)) {
      const item = eventItem(shiftEventDays(event, daysBetweenKeys(anchor, date)), {
        date,
        master: event,
      });
      if (item !== null) items.push(item);
    }
  }
  return items;
}

/** Done tasks stay in — a calendar that hides what you finished is lying about your week. */
function buildTaskItems(tasks: readonly Task[]): CalendarItem[] {
  const items: CalendarItem[] = [];
  for (const task of tasks) {
    if (task.dueDate == null) continue;
    const dayKey = task.dueDate.slice(0, 10);
    if (!isDayKey(dayKey)) continue;
    items.push({
      id: `task-${task.id}`,
      source: "tasks",
      kind: "task",
      task,
      startKey: dayKey,
      endKey: dayKey,
      startMinutes: null,
      endMinutes: null,
      sortKey: dayKey,
    });
  }
  return items;
}

/** Skips an exam whose subject is missing (soft-deleted), exactly as the former agenda merge did. */
function buildExamItems(
  exams: readonly Exam[],
  subjectsById: ReadonlyMap<string, Subject>,
): CalendarItem[] {
  const items: CalendarItem[] = [];
  for (const exam of exams) {
    const subject = subjectsById.get(exam.subjectId);
    if (!subject) continue;
    const dayKey = exam.examDate.slice(0, 10);
    if (!isDayKey(dayKey)) continue;
    items.push({
      id: `exam-${exam.id}`,
      source: "exams",
      kind: "exam",
      exam,
      subject,
      startKey: dayKey,
      endKey: dayKey,
      startMinutes: null,
      endMinutes: null,
      sortKey: dayKey,
    });
  }
  return items;
}

/** Skips a block whose exam or subject is missing, exactly as the former agenda merge did. */
function buildBlockItems(
  blocks: readonly StudyBlockWithExam[],
  examsById: ReadonlyMap<string, Exam>,
  subjectsById: ReadonlyMap<string, Subject>,
): CalendarItem[] {
  const items: CalendarItem[] = [];
  for (const block of blocks) {
    const exam = examsById.get(block.examId);
    const subject = exam ? subjectsById.get(exam.subjectId) : undefined;
    if (!exam || !subject) continue;
    if (!isDayKey(block.blockDate)) continue;
    items.push({
      id: `block-${block.id}`,
      source: "blocks",
      kind: "block",
      block,
      exam,
      subject,
      startKey: block.blockDate,
      endKey: block.blockDate,
      startMinutes: null,
      endMinutes: null,
      sortKey: block.blockDate,
    });
  }
  return items;
}

/**
 * One all-day item per celebration of a person's date inside `range` (ADR-026)
 * — the same window that bounds recurring-event expansion, so a view never
 * pays for a reach it cannot show.
 *
 * A 29 February person is celebrated on the 28th in non-leap years; that
 * clamping lives in `birthdayOccurrencesInRange`, which is also why the age is
 * read off the OCCURRENCE's own year rather than recomputed here.
 */
function buildBirthdayItems(people: readonly Person[], range: CalendarRange): CalendarItem[] {
  // Bounds the core helper would throw on: with nothing to expand over there
  // is no birthday to show at all (unlike an event, whose master still stands
  // on its own start day).
  if (!isValidDayKey(range.from) || !isValidDayKey(range.to)) return [];

  const items: CalendarItem[] = [];
  for (const person of people) {
    for (const date of birthdayOccurrencesInRange(person, range)) {
      items.push({
        // Occurrences of one person share its row id, so the day is what
        // separates them — the same rule a recurring event's items follow.
        id: `person-${person.id}@${date}`,
        source: "birthdays",
        kind: "birthday",
        person,
        age: ageAtOccurrence(person, date),
        startKey: date,
        endKey: date,
        startMinutes: null,
        endMinutes: null,
        sortKey: date,
      });
    }
  }
  return items;
}

/**
 * The other profile's events as calendar items (CAL-005 / ADR-058 §5). No
 * range parameter and no recurrence handling, deliberately: main's overlay
 * query already answered for exactly the visible range with every series
 * expanded into concrete occurrences, so this builder only derives keys and
 * minutes — the same slicing `eventItem` does for the profile's own rows, and
 * the same skip-not-throw discipline on a malformed start.
 */
function buildForeignItems(rows: readonly CalendarOverlayEvent[]): CalendarItem[] {
  const items: CalendarItem[] = [];
  for (const row of rows) {
    const startKey = row.startAt.slice(0, 10);
    if (!isDayKey(startKey)) continue;

    let endKey = row.endAt ? row.endAt.slice(0, 10) : startKey;
    if (!isDayKey(endKey) || endKey < startKey) endKey = startKey;

    let startMinutes: number | null = null;
    let endMinutes: number | null = null;
    if (!row.allDay) {
      startMinutes = parseMinutes(row.startAt.slice(11, 16));
      if (row.endAt && row.endAt.slice(0, 10) === startKey) {
        endMinutes = parseMinutes(row.endAt.slice(11, 16));
      }
    }

    items.push({
      // Occurrences of one foreign master share its row id, so the day is what
      // separates them; the `foreign-` prefix keeps these ids disjoint from
      // the viewer's own `event-` ids in every by-id map downstream.
      id: `foreign-${row.id}@${startKey}`,
      source: "overlay",
      kind: "foreign",
      foreign: row,
      startKey,
      endKey,
      startMinutes,
      endMinutes,
      sortKey: row.allDay ? startKey : row.startAt,
    });
  }
  return items;
}

/**
 * The subscription renewals as calendar items (FIN slice d). No range parameter
 * and no recurrence handling, exactly as `buildForeignItems` has none: main's
 * `fin-recurring:upcoming` read already answered for the visible range with
 * every rule expanded into concrete days, so this builder only derives keys —
 * and the same skip-not-throw discipline on a malformed one.
 *
 * All-day always: a charge lands on a DAY. The ledger is where the money is;
 * this row is what the schedule says, which is why it is drawn for past days
 * too — looking back at a month should show when the charges fell, and looking
 * forward should show when they will.
 */
function buildSubscriptionItems(renewals: readonly FinUpcomingRenewal[]): CalendarItem[] {
  const items: CalendarItem[] = [];
  for (const renewal of renewals) {
    if (!isDayKey(renewal.date)) continue;
    items.push({
      // Renewals of one subscription share its row id, so the day is what
      // separates them — the rule every expanded source here follows.
      id: `subscription-${renewal.recurringId}@${renewal.date}`,
      source: "subscriptions",
      kind: "subscription",
      renewal,
      startKey: renewal.date,
      endKey: renewal.date,
      startMinutes: null,
      endMinutes: null,
      sortKey: renewal.date,
    });
  }
  return items;
}

/**
 * Merges the enabled sources into one calendar stream; only requested sources
 * are built at all. `range` bounds the expansion of recurring event masters
 * and of birthday occurrences, and nothing else — see the file header. (The
 * overlay and renewal rows arrive already range-bounded by main, so they take
 * no `range`.)
 */
export function buildCalendarItems(
  rows: CalendarSourceRows,
  enabled: ReadonlySet<CalendarSource>,
  range: CalendarRange,
): CalendarItem[] {
  const subjectsById = new Map(rows.subjects.map((subject) => [subject.id, subject] as const));
  const examsById = new Map(rows.exams.map((exam) => [exam.id, exam] as const));

  const items: CalendarItem[] = [];
  if (enabled.has("events")) items.push(...buildEventItems(rows.events, range));
  if (enabled.has("tasks")) items.push(...buildTaskItems(rows.tasks));
  if (enabled.has("exams")) items.push(...buildExamItems(rows.exams, subjectsById));
  if (enabled.has("blocks")) items.push(...buildBlockItems(rows.blocks, examsById, subjectsById));
  if (enabled.has("birthdays")) items.push(...buildBirthdayItems(rows.people, range));
  if (enabled.has("overlay")) items.push(...buildForeignItems(rows.overlay));
  if (enabled.has("subscriptions")) items.push(...buildSubscriptionItems(rows.renewals));
  return items;
}

/**
 * Minutes since midnight → "HH:MM". A SERIALIZER, not a label: it builds the
 * `startAt`/`endAt` the store is given and fills `<input type="time">`, so it
 * stays zero-padded 24-hour whatever clock the device reads (CAL §5 — see
 * `calendarPrefs.ts`'s `formatClockLabel` for the display twin).
 */
export function formatClock(minutes: number): string {
  const hours = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mins = String(minutes % 60).padStart(2, "0");
  return `${hours}:${mins}`;
}

/** The last minute a calendar day has — where a seeded end time is clamped rather than spilling into tomorrow. */
export const LAST_MINUTE_OF_DAY = 23 * 60 + 59;

/**
 * "HH:MM" → minutes since midnight, `null` for anything that is not a time of
 * day — `formatClock`'s exact inverse, and the one place a time field's raw
 * value becomes arithmetic. A half-typed or cleared `<input type="time">`
 * yields `null` rather than a number the caller would have to second-guess.
 */
export function parseClock(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (match === null) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours > 23 || minutes > 59 ? null : hours * 60 + minutes;
}

/**
 * Day-granular or multi-day — the items every grid draws as a horizontal bar
 * (a month cell's stack, a week's all-day band) rather than as something with
 * a position in the hour grid.
 */
export function isSpanItem(item: CalendarItem): boolean {
  return item.startMinutes === null || item.endKey !== item.startKey;
}

/**
 * A single-day timed event — the only kind of item the week/day grid lets the
 * pointer move and resize (ADR-034). A timed foreign occurrence lands in the
 * hour grid too (`isTimedForeignItem`), but never in a gesture.
 */
export type TimedEventItem = CalendarItem & { kind: "event"; startMinutes: number };

/** A single-day timed OWN event — hour-grid geometry plus the drag/resize/edit affordances foreign items never get. */
export function isTimedEventItem(item: CalendarItem): item is TimedEventItem {
  return item.kind === "event" && item.startMinutes !== null && item.endKey === item.startKey;
}

/** A single-day timed occurrence of the OTHER profile's calendar (CAL-005): hour-grid geometry, no gestures — its one interaction is the origin popover. */
export type TimedForeignItem = CalendarItem & { kind: "foreign"; startMinutes: number };

export function isTimedForeignItem(item: CalendarItem): item is TimedForeignItem {
  return item.kind === "foreign" && item.startMinutes !== null && item.endKey === item.startKey;
}

/** Quietened rather than hidden: a task already done, a study block already missed. */
export function isMutedItem(item: CalendarItem): boolean {
  if (item.kind === "task") return item.task.done;
  if (item.kind === "block") return item.block.status === "missed";
  return false;
}

const SOURCES_KEY_PREFIX = "nexus.calendar.sources.";

/**
 * Nothing stored, or nothing recognizable stored ⇒ every source enabled, the
 * honest default. An explicitly empty string is NOT that case: it is the user
 * having switched every source off, and reading it back as "all on" would
 * quietly undo a choice they made.
 *
 * A profile that stored its toggles before a source existed keeps exactly the
 * set it named, so a newly added source starts off there — the price of never
 * re-enabling something the user switched off.
 */
export function readStoredSources(profileId: string): Set<CalendarSource> {
  const raw = localStorage.getItem(SOURCES_KEY_PREFIX + profileId);
  if (raw === null) return new Set(CALENDAR_SOURCES);
  if (raw === "") return new Set();
  const known = new Set<string>(CALENDAR_SOURCES);
  const parsed = raw.split(",").filter((value) => known.has(value)) as CalendarSource[];
  return parsed.length > 0 ? new Set(parsed) : new Set(CALENDAR_SOURCES);
}

export function persistSources(profileId: string, sources: ReadonlySet<CalendarSource>): void {
  const ordered = CALENDAR_SOURCES.filter((source) => sources.has(source));
  localStorage.setItem(SOURCES_KEY_PREFIX + profileId, ordered.join(","));
}
