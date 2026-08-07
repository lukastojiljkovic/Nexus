import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, KeyboardEvent } from "react";
import { Button, Checkbox, Chip, EmptyState, ListRow, LoadingState, PageHeader, TextField } from "@nexus/ui";
import { isValidDayKey, monthKeyOf, shiftDayKey, shiftMonthKey, weekDayKeys } from "@nexus/core";
import type { WeekStart } from "@nexus/core";
import { MAX_EVENT_TEMPLATE_NAME_LENGTH } from "../../shared/ipc.js";
import type {
  CalendarOverlayEvent,
  CalendarSettings,
  Event,
  EventFieldChanges,
  EventTemplate,
  Exam,
  FinUpcomingRenewal,
  NewEventFields,
  Person,
  Profile,
  RecurrenceRule,
  StudyBlockWithExam,
  Subject,
  Task,
} from "../../shared/ipc.js";
import { CalendarMiniMonth } from "./CalendarMiniMonth.js";
import { CalendarMonth, ForeignMark } from "./CalendarMonth.js";
import { profileDisplayName } from "./profilePrefs.js";
import { CalendarTimeGrid } from "./CalendarTimeGrid.js";
import type { TimedEventDragTarget } from "./CalendarTimeGrid.js";
import {
  buildDayDensity,
  monthsRange,
  semesterMonthKeys,
  termMonthKeys,
} from "./semesterGrid.js";
import type { DayDensity } from "./semesterGrid.js";
import { useAnchoredPosition } from "./useAnchoredPosition.js";
import {
  buildCalendarItems,
  CALENDAR_SOURCES,
  daysBetweenKeys,
  formatClock,
  LAST_MINUTE_OF_DAY,
  parseClock,
  persistSources,
  readStoredSources,
} from "./calendarItems.js";
import {
  formatClockLabel,
  localMinutesOfDay,
  readStoredClock,
  readStoredEventDuration,
  type ClockPreference,
} from "./calendarPrefs.js";
import type {
  CalendarItem,
  CalendarRange,
  CalendarSource,
  EventOccurrence,
  TimedEventItem,
} from "./calendarItems.js";
import { NotePopover } from "./notePopover.js";
import { RecurrenceMark, RecurrencePicker } from "./RecurrencePicker.js";
import { RecurrenceScopeDialog } from "./RecurrenceScopeDialog.js";
import type { RecurrenceScope } from "./RecurrenceScopeDialog.js";
import { DocumentsPanel } from "./DocumentsPanel.js";
import { PeoplePanel } from "./PeoplePanel.js";
import { daysUntilExam, examCountdownLabel, examCountdownVariant, localTodayKey } from "./examDates.js";
import { readStoredWeekStart, toWeekStart } from "./weekStart.js";
import { formatMoney } from "./money.js";
import { dayUnit, strings } from "./strings.js";
import { moduleName } from "./moduleName.js";

// --- Per-profile view memory (interim, mirrors TasksPage) -------------------
//
// Mesec / Nedelja / Dan / Semestar / Agenda / Dokumenta / Ljudi is a lightweight
// UI preference, persisted per profile in localStorage exactly like the tasks
// list/kanban toggle.
type CalendarView = "mesec" | "nedelja" | "dan" | "semestar" | "agenda" | "dokumenta" | "ljudi";
/** Every view, in the order the toggle draws them — also what a stored value is checked against. */
const CALENDAR_VIEWS = [
  "mesec",
  "nedelja",
  "dan",
  "semestar",
  "agenda",
  "dokumenta",
  "ljudi",
] as const satisfies readonly CalendarView[];
const VIEW_LABEL: Record<CalendarView, string> = {
  mesec: strings.calendar.viewMesec,
  nedelja: strings.calendar.viewNedelja,
  dan: strings.calendar.viewDan,
  semestar: strings.calendar.viewSemestar,
  agenda: strings.calendar.viewAgenda,
  dokumenta: strings.calendar.viewDokumenta,
  ljudi: strings.calendar.viewLjudi,
};
const VIEW_KEY_PREFIX = "nexus.calendar.view.";

/** The two views that replace the whole event surface with a panel of their own. */
function isPanelView(view: CalendarView): boolean {
  return view === "dokumenta" || view === "ljudi";
}

/** Narrowing helper over the stored string — never a cast, so an unknown value falls through to the default. */
function isCalendarView(value: string | null): value is CalendarView {
  return CALENDAR_VIEWS.some((view) => view === value);
}

function readStoredView(profileId: string): CalendarView {
  // Anything unrecognized — including a profile that has never chosen — opens
  // on the month, the view this page has always defaulted to.
  const raw = localStorage.getItem(VIEW_KEY_PREFIX + profileId);
  return isCalendarView(raw) ? raw : "mesec";
}
function persistView(profileId: string, view: CalendarView): void {
  localStorage.setItem(VIEW_KEY_PREFIX + profileId, view);
}

/** Serbian Latin tailoring — plain `"sr"` mis-orders š/č/ć (the house pattern every alphabetical list here follows). */
const collator = new Intl.Collator(["sr-Latn", "sr"]);

// "overlay" is deliberately absent: its label is kind-dependent (CAL-005 —
// „Poslovni kalendar“ / „Privatni kalendar“), so the page derives it from the
// OTHER profile's kind where the chip renders, and `Exclude` makes forgetting
// that a compile error rather than an undefined label.
const SOURCE_LABEL: Record<Exclude<CalendarSource, "overlay">, string> = {
  events: strings.calendar.sourceEvents,
  tasks: strings.calendar.sourceTasks,
  exams: strings.calendar.sourceExams,
  blocks: strings.calendar.sourceBlocks,
  birthdays: strings.calendar.sourceBirthdays,
  subscriptions: strings.calendar.sourceSubscriptions,
};

// --- Agenda grouping (page-level, not the views engine) ---------------------
//
// The store returns events ordered by startAt then id, but the create path
// appends optimistically, so the display order is re-derived here rather than
// trusted from insertion order. The rule matches the store's exactly — an
// all-day event's bare "YYYY-MM-DD" sorts before any timed start on that day.
// Tasks, exams (STUDY-002), study blocks (STUDY-003) and birthdays (CAL-007)
// are merged in as read-only rows: their bare dates sort the same way a bare
// all-day date does, ahead of any timed event; within one bare date, kind rank
// keeps the order deterministic. Birthdays sit with the all-day cluster right
// after events — a name is the first thing a day should say.
const KIND_RANK: Record<CalendarItem["kind"], number> = {
  event: 0,
  // A foreign event IS an event — it sits with the events, right after the
  // profile's own on a shared bare date (timed rows interleave by startAt
  // regardless, since rank only breaks sortKey ties).
  foreign: 1,
  birthday: 2,
  task: 3,
  exam: 4,
  block: 5,
  // Last on a shared day: a renewal is a fact about money, not about what the
  // day asks of you, so it reads as the footnote it is.
  subscription: 6,
};

/** Calendar items bucketed by calendar day, days and rows both ascending. */
function groupAgenda(items: readonly CalendarItem[]): [string, CalendarItem[]][] {
  const ordered = [...items].sort((a, b) => {
    const cmp = a.sortKey.localeCompare(b.sortKey);
    if (cmp !== 0) return cmp;
    const rank = KIND_RANK[a.kind] - KIND_RANK[b.kind];
    if (rank !== 0) return rank;
    return a.id.localeCompare(b.id);
  });
  const groups = new Map<string, CalendarItem[]>();
  for (const item of ordered) {
    const bucket = groups.get(item.startKey);
    if (bucket) bucket.push(item);
    else groups.set(item.startKey, [item]);
  }
  return [...groups];
}

/**
 * Day-section header in Serbian (e.g. "sreda, 8. jul"); raw key on bad input.
 * The key is a bare calendar day, so it is both parsed and formatted in UTC —
 * otherwise `new Date("YYYY-MM-DD")` (UTC midnight) would shift a day back when
 * formatted in a negative-offset timezone.
 */
function formatDay(key: string): string {
  const date = new Date(key);
  return Number.isNaN(date.getTime())
    ? key
    : new Intl.DateTimeFormat("sr-Latn", {
        weekday: "long",
        day: "numeric",
        month: "long",
        timeZone: "UTC",
      }).format(date);
}

/** Row time label — "Ceo dan" for all-day, else the device's clock (CAL §5); raw start on bad input. Takes the two fields it reads, so the overlay's minimized rows use the same rule as full events. */
function formatTime(event: Pick<Event, "allDay" | "startAt">, clock: ClockPreference): string {
  if (event.allDay) return strings.calendar.allDay;
  const date = new Date(event.startAt);
  return Number.isNaN(date.getTime())
    ? event.startAt
    : formatClockLabel(localMinutesOfDay(date), clock);
}

const monthLabelFormatter = new Intl.DateTimeFormat("sr-Latn", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/** Nav header label, e.g. "jul 2026" — Serbian month names are already lower-case. */
function formatMonthLabel(key: string): string {
  const date = new Date(key);
  return Number.isNaN(date.getTime()) ? key : monthLabelFormatter.format(date);
}

const monthNameFormatter = new Intl.DateTimeFormat("sr-Latn", { month: "long", timeZone: "UTC" });

/** Bare month name (e.g. "avgust"); degrades to the key's month digits on bad input. */
function formatMonthName(key: string): string {
  const date = new Date(key);
  return Number.isNaN(date.getTime()) ? key.slice(5, 7) : monthNameFormatter.format(date);
}

/**
 * Week nav label: "3 — 9. avgust 2026" within one month, "31. avgust — 6.
 * septembar 2026" when the row crosses a month boundary. Built from day
 * numbers + a bare month name rather than one combined Intl call, because
 * sr-Latn's day+month+year pattern trails a period after the year too (see
 * formatExamDate) — not what either example above shows.
 */
function formatWeekLabel(weekKeys: readonly string[]): string {
  const start = weekKeys[0];
  const end = weekKeys[6];
  if (start === undefined || end === undefined) return "";
  const startDay = Number(start.slice(8, 10));
  const endDay = Number(end.slice(8, 10));
  const year = end.slice(0, 4);
  if (start.slice(0, 7) === end.slice(0, 7)) {
    return `${startDay} — ${endDay}. ${formatMonthName(end)} ${year}`;
  }
  return `${startDay}. ${formatMonthName(start)} — ${endDay}. ${formatMonthName(end)} ${year}`;
}

/**
 * Semester nav label: „jul — oktobar 2026“ within one year, „novembar 2026 —
 * februar 2027“ across a year end. Composed from bare month names for the same
 * reason `formatWeekLabel` is — sr-Latn's combined month+year pattern trails a
 * period this header does not want.
 */
function formatSemesterLabel(monthKeys: readonly string[]): string {
  const first = monthKeys[0];
  const last = monthKeys.at(-1);
  if (first === undefined || last === undefined) return "";
  const firstYear = first.slice(0, 4);
  const lastYear = last.slice(0, 4);
  const opening =
    firstYear === lastYear ? formatMonthName(first) : `${formatMonthName(first)} ${firstYear}`;
  return `${opening} — ${formatMonthName(last)} ${lastYear}`;
}

const dayLabelFormatter = new Intl.DateTimeFormat("sr-Latn", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/** Day nav label, e.g. "sreda, 8. jul 2026." */
function formatDayLabel(key: string): string {
  const date = new Date(key);
  return Number.isNaN(date.getTime()) ? key : dayLabelFormatter.format(date);
}

// Study blocks are fetched over a bounded window around today (the agenda
// itself has no explicit bounds): a month back covers recently missed blocks,
// a year ahead outruns any plannable exam distance.
const BLOCKS_PAST_DAYS = 31;
const BLOCKS_FUTURE_DAYS = 365;

/**
 * A month grid is six whole weeks: it opens at most six days before the 1st and
 * runs 42 days from there. Padding by a week on the near side keeps the bound
 * honest without recomputing the grid the month view builds for itself.
 */
const MONTH_RANGE_BEFORE = 7;
const MONTH_RANGE_AFTER = 41;

/** Shared by every view that is not Semestar, so no render allocates a map it will not read. */
const EMPTY_DENSITY: ReadonlyMap<string, DayDensity> = new Map();

// --- Reminders (CAL-006) ----------------------------------------------------

const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 1_440;

/** The offered lead times, in minutes. Anything else an event already carries gets a chip of its own beside these. */
const REMINDER_LADDER: readonly number[] = [0, 10, 30, 60, MINUTES_PER_DAY];

/**
 * A lead time as its chip label: "U vreme početka", "10 min ranije",
 * "1 h ranije", "1 dan ranije". Whole days and whole hours take their own unit,
 * so the ladder and any offset outside it (a restored archive, a longer lead
 * set on another device) are worded by the one rule rather than two.
 */
function reminderLabel(minutes: number): string {
  const s = strings.calendar.reminders;
  if (minutes === 0) return s.atStart;
  if (minutes % MINUTES_PER_DAY === 0) {
    const days = minutes / MINUTES_PER_DAY;
    return `${days} ${dayUnit(days, "dan", "dana")} ${s.before}`;
  }
  if (minutes % MINUTES_PER_HOUR === 0) {
    return `${minutes / MINUTES_PER_HOUR} ${s.hoursUnit} ${s.before}`;
  }
  return `${minutes} ${s.minutesUnit} ${s.before}`;
}

/**
 * The chips to draw: the fixed ladder plus every offset the edited event
 * carries that the ladder cannot say, in ascending order. Without that union an
 * edit would silently drop a lead time merely because no chip could express it.
 */
function reminderChoices(selected: readonly number[]): number[] {
  const extra = selected.filter((minutes) => !REMINDER_LADDER.includes(minutes));
  return [...new Set([...REMINDER_LADDER, ...extra])].sort((a, b) => a - b);
}

/**
 * Everything one submit of the event form asks for (ADR-024). Collected once,
 * then either written straight away (a one-off) or held while the scope dialog
 * asks which occurrences the edit reaches.
 */
interface EditedEventFields {
  title: string;
  /** The form's own day key — for an occurrence edit, where the user moved it to. */
  date: string;
  time: string;
  endTime: string;
  allDay: boolean;
  startAt: string;
  /** Timed events only; null clears a stored end time (all-day never sends one). */
  endAt: string | null;
  location: string | null;
  recurrence: RecurrenceRule | null;
  /** Lead times in whole minutes (CAL-006); empty clears every reminder. */
  reminderOffsets: number[];
}

/**
 * The minutes a week/day-grid drag landed on (ADR-034). A month-grid drag says
 * nothing about the time of day, so it carries null here and the moved event
 * keeps whatever time it had.
 */
interface TimedDragMinutes {
  readonly startMinutes: number;
  readonly endMinutes: number | null;
}

/**
 * A series operation waiting on the "Samo ovaj / Ovaj i budući / Svi" answer.
 * Each variant carries everything its own branch needs, so the dialog's answer
 * is all that is still missing when it arrives.
 */
type PendingSeries =
  | { kind: "edit"; occurrence: EventOccurrence; fields: EditedEventFields }
  | { kind: "delete"; occurrence: EventOccurrence }
  | {
      kind: "move";
      occurrence: EventOccurrence;
      event: Event;
      fromKey: string;
      toKey: string;
      /** Non-null when the drag came from the hour grid: the same move, said to the minute. */
      minutes: TimedDragMinutes | null;
    };

/**
 * The form's collected fields as a create payload; only present values are sent
 * (exactOptionalPropertyTypes).
 *
 * `carry` is the row this one is being split off from — the master, when an
 * occurrence is detached or a series restarted. Editing an existing event
 * normally leaves everything the form does not show alone, but these two flows
 * CREATE a row, so whatever the form cannot express has to be carried across
 * explicitly or it is lost: the description, the category, and the day span of
 * a multi-day all-day event (which has no end field in this form at all).
 */
function newEventFields(
  fields: EditedEventFields,
  rule: RecurrenceRule | null,
  carry: Event | null,
): NewEventFields {
  const payload: NewEventFields = {
    title: fields.title,
    startAt: fields.startAt,
    allDay: fields.allDay,
    // The form CAN say this one, so it travels with the fields rather than
    // being carried: a detached occurrence and a split-off master both keep the
    // reminders the user was looking at when they hit save.
    reminderOffsets: fields.reminderOffsets,
  };
  if (fields.location !== null) payload.location = fields.location;
  if (!fields.allDay && fields.endAt !== null) payload.endAt = fields.endAt;
  if (carry !== null) {
    if (carry.description !== null) payload.description = carry.description;
    if (carry.category !== null) payload.category = carry.category;
    if (fields.allDay && carry.endAt !== null) {
      const span = daysBetweenKeys(carry.startAt.slice(0, 10), carry.endAt.slice(0, 10));
      if (span > 0) payload.endAt = shiftDayKey(fields.date, span);
    }
  }
  if (rule !== null) payload.recurrence = rule;
  return payload;
}

/** An event's start/end moved `delta` whole days, time of day and duration untouched. */
function shiftEventChanges(event: Event, delta: number): EventFieldChanges {
  const newStartDate = shiftDayKey(event.startAt.slice(0, 10), delta);
  const changes: EventFieldChanges = {
    startAt: event.allDay ? newStartDate : `${newStartDate}T${event.startAt.slice(11, 16)}`,
  };
  if (event.endAt) {
    const newEndDate = shiftDayKey(event.endAt.slice(0, 10), delta);
    changes.endAt = event.allDay ? newEndDate : `${newEndDate}T${event.endAt.slice(11, 16)}`;
  }
  return changes;
}

/**
 * A full copy of an event moved `delta` whole days — what a detached occurrence
 * or a new series master is created from. `minutes` retimes that copy onto the
 * exact span a week/day-grid drag landed on (ADR-034); a month-grid drag passes
 * null and the copy keeps the time of day it always had.
 */
function copyEventFields(
  event: Event,
  delta: number,
  rule: RecurrenceRule | null,
  minutes: TimedDragMinutes | null,
): NewEventFields {
  const moved = shiftEventChanges(event, delta);
  const payload: NewEventFields = {
    title: event.title,
    startAt: moved.startAt ?? event.startAt,
    allDay: event.allDay,
    // A copy that lost its reminders would silently stop notifying.
    reminderOffsets: [...event.reminderOffsets],
  };
  if (moved.endAt != null) payload.endAt = moved.endAt;
  if (event.location !== null) payload.location = event.location;
  if (event.description !== null) payload.description = event.description;
  if (event.category !== null) payload.category = event.category;
  if (rule !== null) payload.recurrence = rule;
  if (minutes !== null) {
    // The day is already right (shiftEventChanges moved it); only the clock
    // parts are replaced, and an event dragged as a point stays a point.
    const dayKey = payload.startAt.slice(0, 10);
    payload.startAt = `${dayKey}T${formatClock(minutes.startMinutes)}`;
    payload.endAt =
      minutes.endMinutes === null ? null : `${dayKey}T${formatClock(minutes.endMinutes)}`;
  }
  return payload;
}

/**
 * What a week/day-grid drag amounts to as an edit of the row it dropped
 * (ADR-034), or null when it landed exactly where it was picked up. A move
 * states both endpoints at once, so the store validates the pair rather than an
 * end that momentarily precedes its new start.
 */
function timedDragChanges(event: Event, target: TimedEventDragTarget): EventFieldChanges | null {
  const startAt = `${target.dayKey}T${formatClock(target.startMinutes)}`;
  const endAt =
    target.endMinutes === null ? null : `${target.dayKey}T${formatClock(target.endMinutes)}`;
  if (startAt === event.startAt && endAt === event.endAt) return null;
  return { startAt, endAt };
}

/**
 * A pending deep-link target (021-e global search / palette commands).
 * `reveal-document` only carries the view switch here — `DocumentsPanel`
 * (rendered below with `revealDocumentId`) owns loading it into its own form
 * and marking its row, since that is where its edit path and its rows live.
 */
export type CalendarIntent =
  | { kind: "reveal-event"; eventId: string }
  | { kind: "reveal-document"; documentId: string }
  | { kind: "create-event" };

export interface CalendarPageProps {
  profileId: string;
  /**
   * The account's OTHER profile, or null while there is none (CAL-005 /
   * ADR-058 §5) — the overlay chip's origin. V1 keeps one personal anchor
   * plus at most one business profile, so "the other profile" is at most one
   * row; the chip, the fetch and the popover all hang off it being non-null.
   */
  overlayProfile: Profile | null;
  /** The origin popover's „Prebaci profil“ — routes through App's passcode-gated switch dialog (AUTH-024), never a switch of its own. */
  onSwitchToProfile: (profile: Profile) => void;
  intent?: CalendarIntent | null;
  /** Reports that `intent` above has been acted on, so the caller (App.tsx) can clear it. */
  onIntentHandled?: () => void;
}

/**
 * The CAL module page: a month grid, an agenda, and the Dokumenta and Ljudi
 * panels over one shared item stream (ADR-020). The event form both adds and
 * edits; every write goes through the events:* and tasks:* IPC allowlists, so
 * the store stays the single source of truth (e.g. it validates startAt and
 * derives updatedAt). Upcoming exams (STUDY-002), study blocks (STUDY-003) and
 * birthdays (CAL-007) are merged in as read-only rows; tasks are read-only too
 * apart from a due-date drag — editing any of them lives on their own pages
 * (a birthday's is the Ljudi panel a click on its bar switches to).
 *
 * The cross-profile overlay (CAL-005 / ADR-058 §5) merges the OTHER profile's
 * events in as `foreign` items: read-only guests that never join drag, resize
 * or the form. Creating an event always targets the ACTIVE profile — every
 * write on this page goes through the `profileId` prop, and a foreign item
 * reaches no write path (each is guarded by its own `kind`).
 */
export function CalendarPage({
  profileId,
  overlayProfile,
  onSwitchToProfile,
  intent,
  onIntentHandled,
}: CalendarPageProps) {
  const [events, setEvents] = useState<Event[] | null>(null);
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [subjects, setSubjects] = useState<Subject[] | null>(null);
  const [exams, setExams] = useState<Exam[] | null>(null);
  const [blocks, setBlocks] = useState<StudyBlockWithExam[] | null>(null);
  // Topic names for the agenda's block rows (ADR-063): id → name over the
  // exams the fetched blocks actually reference. Read-only, like the rows.
  const [topicNames, setTopicNames] = useState<ReadonlyMap<string, string>>(new Map());
  const [people, setPeople] = useState<Person[] | null>(null);
  // The profile's semester dates (CAL-010 / ADR-054) — what the Semestar view
  // anchors to when set, loaded with everything else below.
  const [term, setTerm] = useState<CalendarSettings | null>(null);
  // Narrowed once: non-null exactly when a term is SET (the store's pair rule
  // means the two are only ever null together, and this is where that pays).
  const activeTerm =
    term !== null && term.semesterStart !== null && term.semesterEnd !== null
      ? { start: term.semesterStart, end: term.semesterEnd }
      : null;
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<CalendarView>(() => readStoredView(profileId));
  const [sources, setSources] = useState<ReadonlySet<CalendarSource>>(() =>
    readStoredSources(profileId),
  );
  // PRD 04 §5, read once on mount: the shell renders exactly one module page at
  // a time, so leaving Podešavanja and coming back here remounts this component
  // and picks up a changed setting. Nothing needs to watch localStorage.
  const [weekStart] = useState<WeekStart>(() => toWeekStart(readStoredWeekStart()));
  // CAL §5's two preferences, read on every render rather than frozen the way
  // `weekStart` is. Neither feeds a layout this page computes once — the clock
  // only decides how a label reads, and the duration is only consulted the
  // moment the form seeds an end time — so there is nothing to keep stable
  // across a redraw, and a change made in Podešavanja lands as soon as this
  // page draws again rather than only on the next remount.
  const clock = readStoredClock();
  const eventDuration = readStoredEventDuration();
  // The single anchor day every grid view derives from: the month view takes
  // its month, the week view the week around it (starting on whichever weekday
  // `weekStart` says), the day view the key itself — so "Danas" and the
  // keyboard shortcuts have exactly one thing to reset regardless of which of
  // the three is showing.
  const [anchorKey, setAnchorKey] = useState<string>(() => localTodayKey());
  const [pendingUndoId, setPendingUndoId] = useState<string | null>(null);
  // The other profile's events for the current range (CAL-005) — [] while the
  // chip is off, the fetch is in flight, or the account has one profile.
  // Deliberately outside `dataLoading`: a courtesy layer pops in when it
  // arrives rather than gating the profile's own calendar.
  const [overlay, setOverlay] = useState<CalendarOverlayEvent[]>([]);
  const [overlayFailed, setOverlayFailed] = useState(false);
  /** FIN slice d: the renewals the subscriptions' rules place in the visible range. */
  const [renewals, setRenewals] = useState<FinUpcomingRenewal[]>([]);
  // The origin popover a foreign item's click opens (CAL-005): the clicked
  // element's rectangle, captured at click time, or null while closed. A
  // captured rect rather than a ref because the triggers are scattered across
  // three grids and the agenda, all of which re-render their chips freely — a
  // handle on the element could go detached under an open popover, where a
  // rectangle simply stays where the user clicked.
  const [foreignAnchor, setForeignAnchor] = useState<DOMRect | null>(null);

  // One form serves both modes; a non-null editingId means "editing that event".
  // When that event is one occurrence of a series, `editingOccurrence` says
  // which day it is — the form still edits the master's row, but every write
  // has to know where in the series the user was standing.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingOccurrence, setEditingOccurrence] = useState<EventOccurrence | null>(null);
  const [title, setTitle] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [endTime, setEndTime] = useState("");
  // CAL §5. False while the end field still holds whatever the form put there
  // (nothing, a slot click's span, the default duration), true the moment the
  // user types in it — including typing it EMPTY, which is a deliberate "this
  // event has no end" and must survive a later change of start just as a typed
  // time does. An event opened for editing starts out touched: its end is
  // already somebody's answer.
  const [endTimeTouched, setEndTimeTouched] = useState(false);
  const [location, setLocation] = useState("");
  const [recurrence, setRecurrence] = useState<RecurrenceRule | null>(null);
  const [reminderOffsets, setReminderOffsets] = useState<number[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  // Every write OUTSIDE the live form (delete, undo, a series-scope choice, a
  // drag) — the HABIT page's own split between a form's own `formError` and
  // the page-wide `actionError`.
  const [actionError, setActionError] = useState<string | null>(null);
  // True for the span of the form's own write, so a second Enter cannot fire
  // a second create/update while the first is still in flight.
  const [saving, setSaving] = useState(false);
  const [pendingSeries, setPendingSeries] = useState<PendingSeries | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  // Šabloni (CAL-009). Both ends of the feature hang off the ONE form this page
  // already has, because that form is the only per-event surface every view
  // reaches: a click on a bar in Mesec/Nedelja/Dan and the ✎ in Agenda all end
  // in `startEdit`, so an action placed there is available from all four, while
  // one placed on an agenda row would exist in exactly one of them.
  //  - creating (`editingId === null`) → „Šabloni“, which applies onto the day
  //    the form names;
  //  - editing an existing event → the „⋯“ that captures it.
  // They are mutually exclusive because the form's own mode is.
  const [templates, setTemplates] = useState<EventTemplate[]>([]);
  const [templateNaming, setTemplateNaming] = useState(false);
  const [templateDraft, setTemplateDraft] = useState("");
  const [templateFailed, setTemplateFailed] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        // Sync every study plan first so past blocks are already labelled
        // `missed` when the agenda/grid reads them.
        await window.nexus.syncAllPlans(profileId);
        const today = localTodayKey();
        const [
          nextEvents,
          nextTasks,
          nextSubjects,
          nextExams,
          nextBlocks,
          nextPeople,
          nextTemplates,
          nextTerm,
        ] = await Promise.all([
          window.nexus.listEvents(profileId),
          window.nexus.listTasks(profileId),
          window.nexus.listSubjects(profileId),
          window.nexus.listExams(profileId),
          window.nexus.listBlocksInRange(
            profileId,
            shiftDayKey(today, -BLOCKS_PAST_DAYS),
            shiftDayKey(today, BLOCKS_FUTURE_DAYS),
          ),
          window.nexus.listPeople(profileId),
          window.nexus.listEventTemplates(profileId),
          window.nexus.calendarSettings(profileId),
        ]);
        // Resolve the topic names the fetched blocks point at (ADR-063): one
        // list per distinct exam that actually carries topic-bearing blocks —
        // few in practice (only exams with active plans generate blocks).
        const topicExamIds = [
          ...new Set(
            nextBlocks.filter((block) => block.topicId !== null).map((block) => block.examId),
          ),
        ];
        const topicLists = await Promise.all(
          topicExamIds.map((examId) => window.nexus.listExamTopics(profileId, examId)),
        );
        if (!active) return;
        setEvents(nextEvents);
        setTasks(nextTasks);
        setSubjects(nextSubjects);
        setExams(nextExams);
        setBlocks(nextBlocks);
        setTopicNames(new Map(topicLists.flat().map((topic) => [topic.id, topic.name])));
        setPeople(nextPeople);
        setTemplates(nextTemplates);
        setTerm(nextTerm);
      } catch (error) {
        if (active) setFailed(true);
        console.error("Nexus: failed to load events:", error);
      }
    })();
    return () => {
      active = false;
    };
  }, [profileId]);

  function selectView(next: CalendarView): void {
    setView(next);
    persistView(profileId, next);
  }

  function toggleSource(source: CalendarSource): void {
    setSources((prev) => {
      const next = new Set(prev);
      if (next.has(source)) next.delete(source);
      else next.add(source);
      persistSources(profileId, next);
      return next;
    });
  }

  /**
   * A foreign item's one interaction (CAL-005): opens the origin popover under
   * the clicked element — never an editor.
   *
   * Placement, portalling and dismissal all belong to `useAnchoredPosition`
   * now. This file used to carry its own copy of `NotePopover`'s arithmetic and
   * a verbatim copy of its two dismiss listeners, which is how the popover
   * inherited every one of that arithmetic's faults: no flip, no clamp, and a
   * `right:` offset that let a wide panel run off the left edge.
   */
  function openForeignPopover(anchor: DOMRect): void {
    setForeignAnchor(anchor);
  }

  const foreignPopover = useAnchoredPosition({
    open: foreignAnchor !== null,
    anchor: () => foreignAnchor,
    onClose: () => setForeignAnchor(null),
  });

  // Focus moves onto the one action the instant this `role="menu"` opens —
  // the same WAI-ARIA APG rule `notePopover.tsx` follows; this panel is
  // hand-rolled rather than built on `NotePopover` (there is no persistent
  // trigger element to anchor it to — see `openForeignPopover`'s own note),
  // so the one-item version of that rule is repeated here rather than shared.
  useEffect(() => {
    if (foreignAnchor === null) return;
    foreignPopover.panelRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [foreignAnchor, foreignPopover.panelRef]);

  function resetForm(): void {
    setEditingId(null);
    setEditingOccurrence(null);
    setTitle("");
    setAllDay(false);
    setDate("");
    setTime("");
    setEndTime("");
    setEndTimeTouched(false);
    setLocation("");
    setRecurrence(null);
    setReminderOffsets([]);
    setFormError(null);
    // The capture prompt belongs to the event the form was holding; leaving edit
    // mode leaves it too, rather than offering to name a template for nothing.
    setTemplateNaming(false);
    setTemplateDraft("");
  }

  /** Adds or removes one lead time; the store owns ordering, so the set is kept as picked. */
  function toggleReminder(minutes: number): void {
    setReminderOffsets((prev) =>
      prev.includes(minutes) ? prev.filter((current) => current !== minutes) : [...prev, minutes],
    );
  }

  /**
   * Loads an event into the shared form and switches it to edit mode. The
   * `event` handed in is what the user clicked — for a series that is the
   * occurrence's own day-shifted copy, so the form shows the day they aimed at
   * while `occurrence.master` stays the row every write addresses.
   */
  function startEdit(event: Event, occurrence: EventOccurrence | null): void {
    const master = occurrence?.master ?? event;
    setEditingId(master.id);
    setEditingOccurrence(occurrence);
    setTitle(event.title);
    setAllDay(event.allDay);
    setDate(event.startAt.slice(0, 10));
    setTime(event.allDay ? "" : event.startAt.slice(11, 16));
    setEndTime(!event.allDay && event.endAt ? event.endAt.slice(11, 16) : "");
    // A stored end — including a stored ABSENCE of one — is already the user's
    // answer, so moving the start of an existing event never rewrites it.
    setEndTimeTouched(true);
    setLocation(event.location ?? "");
    setRecurrence(master.recurrence);
    // Reminders belong to the stored row, so they are read off the master —
    // the occurrence copy carries them, but the master is what a write reaches.
    setReminderOffsets([...master.reminderOffsets]);
    setFormError(null);
    titleRef.current?.focus();
  }

  /**
   * A series master reached without a grid item behind it (the search deep-link
   * below): its own start day is its first occurrence, which is the one an edit
   * from there is anchored on.
   */
  function occurrenceOfMaster(event: Event): EventOccurrence | null {
    return event.recurrence === null
      ? null
      : { date: event.startAt.slice(0, 10), master: event };
  }

  // Consumes a pending deep-link (021-e): "create-event" and "reveal-event"
  // are handled entirely here, reusing `startEdit`/`resetForm` rather than a
  // second path into the form; "reveal-document" only switches to the
  // Dokumenta view — `DocumentsPanel` below (given `revealDocumentId`) owns
  // loading the document into ITS form and marking its row, since neither
  // its edit path nor its rows live here, and reports completion through the
  // very same `onIntentHandled` this effect would otherwise call. Keyed on
  // `intent`/`events`/`view` rather than mount, so a search fired while
  // already on Kalendar retriggers this exactly like one that switches
  // modules here does, and a load race (the target arrives before `events`
  // has fetched) resolves itself once `events` changes instead of dropping it.
  //
  // Neither CalendarMonth nor CalendarTimeGrid is in this slice's file list,
  // so an event reveal cannot mark a bar/chip inside the grid the way a task
  // or study row can — landing on the right day with the event loaded into
  // the (now visibly populated) form is the whole of "obvious which one".
  useEffect(() => {
    if (!intent) return;
    if (intent.kind === "create-event") {
      if (isPanelView(view)) {
        selectView("agenda");
        return; // wait for the form to actually mount before focusing it
      }
      resetForm();
      titleRef.current?.focus();
      onIntentHandled?.();
      return;
    }
    if (intent.kind === "reveal-document") {
      if (view !== "dokumenta") selectView("dokumenta");
      return; // DocumentsPanel calls onIntentHandled once it has acted
    }
    // reveal-event
    if (events === null) return; // still loading — wait rather than deciding it's missing
    const event = events.find((e) => e.id === intent.eventId);
    if (!event) {
      onIntentHandled?.(); // deleted between indexing and clicking — do nothing else
      return;
    }
    if (isPanelView(view)) {
      selectView("agenda");
      return; // wait for the form to mount before loading the event into it
    }
    setAnchorKey(event.startAt.slice(0, 10));
    startEdit(event, occurrenceOfMaster(event));
    onIntentHandled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent, events, view, onIntentHandled]);

  /** Click on a month-grid day cell's empty area: prefill the form's date and focus the title. */
  function selectDay(dayKey: string): void {
    resetForm();
    setDate(dayKey);
    titleRef.current?.focus();
  }

  /**
   * The end an untouched field is seeded with: the start plus this device's
   * default duration (CAL §5), clamped to the day's last minute rather than
   * spilling into tomorrow — an event that crosses midnight is a date change,
   * not something a duration setting gets to make silently.
   *
   * Two cases seed NOTHING rather than something unusable, so the form can
   * never put a value in the field that its own submit guard would then
   * reject:
   *
   *  - a start that is not a time of day at all (empty, half-typed) — which is
   *    also how clearing the start clears the end the form had put there;
   *  - a start so late that the clamp lands on or before it (23:59 has no room
   *    left in the day for any end).
   */
  function seedEndTime(startTime: string): string {
    const startMinutes = parseClock(startTime);
    if (startMinutes === null) return "";
    const endMinutes = Math.min(startMinutes + eventDuration, LAST_MINUTE_OF_DAY);
    return endMinutes > startMinutes ? formatClock(endMinutes) : "";
  }

  /** Click on empty hour-grid space (week/day view): prefill date, a span of the default duration, and focus the title. */
  function selectSlot(dayKey: string, minutes: number): void {
    resetForm(); // also clears the touched flag — the span below is the form's, not the user's
    const startTime = formatClock(minutes);
    setDate(dayKey);
    setTime(startTime);
    setEndTime(seedEndTime(startTime)); // one seeding rule, whichever way the form was reached
    titleRef.current?.focus();
  }

  /** Click on a column header (week/day) or a month day-number: jump to that day's Dan view. */
  function openDay(dayKey: string): void {
    setAnchorKey(dayKey);
    selectView("dan");
  }

  function shiftPeriod(delta: number): void {
    // A SET term does not slide (ADR-054): the Semestar view is anchored to
    // its dates, so ←/→ have nothing to move — the buttons are disabled below,
    // and the arrow keys land here to be ignored for the same reason.
    if (view === "semestar" && activeTerm !== null) return;
    setAnchorKey((prev) => {
      // Semestar with no term moves a month at a time, like Mesec: the window
      // is scanned by sliding it, not by jumping four months past what you
      // were looking at.
      if (view === "mesec" || view === "semestar") {
        return `${shiftMonthKey(monthKeyOf(prev), delta)}-01`;
      }
      if (view === "nedelja") return shiftDayKey(prev, delta * 7);
      return shiftDayKey(prev, delta);
    });
  }
  function goToday(): void {
    setAnchorKey(localTodayKey());
  }
  function handleGridKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      shiftPeriod(-1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      shiftPeriod(1);
    } else if (event.key === "Home") {
      event.preventDefault();
      goToday();
    }
  }

  async function reload(): Promise<void> {
    setEvents(await window.nexus.listEvents(profileId));
  }

  // --- Šabloni (CAL-009) ----------------------------------------------------

  /**
   * The day a template lands on. A template carries no date at all, so this is
   * the one thing the UI must supply — and the honest answer is what the form
   * itself already names: the date field, which every way into this form fills
   * in (a click on a month cell, a drag over an hour slot, an event opened for
   * editing). Only when the field is empty or half-typed does it fall back to
   * `anchorKey`, the single day every grid view derives from and „Danas“ resets
   * — which is the day the user is looking at.
   */
  const templateDay = isValidDayKey(date) ? date : anchorKey;

  function beginSaveTemplate(currentTitle: string): void {
    setTemplateFailed(false);
    // Prefilled with the event's own title, the way TASK-010's prompt is: most
    // templates are named after the thing they make, and the rest is one edit.
    setTemplateDraft(currentTitle);
    setTemplateNaming(true);
  }

  function closeTemplatePrompt(): void {
    setTemplateNaming(false);
    setTemplateDraft("");
  }

  async function submitSaveTemplate(eventId: string, close: () => void): Promise<void> {
    const name = templateDraft.trim();
    if (name.length === 0) return;
    try {
      setTemplateFailed(false);
      await window.nexus.captureEventTemplate(profileId, eventId, name);
      setTemplates(await window.nexus.listEventTemplates(profileId));
      closeTemplatePrompt();
      close();
    } catch (error) {
      console.error("Nexus: failed to save the event template:", error);
      setTemplateFailed(true);
    }
  }

  async function applyTemplate(template: EventTemplate, close: () => void): Promise<void> {
    try {
      setTemplateFailed(false);
      await window.nexus.applyEventTemplate(profileId, template.id, templateDay);
      // Move to the day it landed on before re-reading: the form's date can name
      // a day no view is currently showing, and an event the user cannot see is
      // indistinguishable from one that was never created.
      setAnchorKey(templateDay);
      await reload();
      close();
    } catch (error) {
      console.error("Nexus: failed to apply the event template:", error);
      setTemplateFailed(true);
    }
  }

  async function deleteTemplate(id: string): Promise<void> {
    try {
      setTemplateFailed(false);
      await window.nexus.deleteEventTemplate(profileId, id);
      setTemplates(await window.nexus.listEventTemplates(profileId));
    } catch (error) {
      console.error("Nexus: failed to delete the event template:", error);
      setTemplateFailed(true);
    }
  }

  async function submitForm(formEvent: FormEvent<HTMLFormElement>): Promise<void> {
    formEvent.preventDefault();
    if (saving) return;
    const trimmedTitle = title.trim();
    if (trimmedTitle.length === 0) {
      setFormError(strings.calendar.invalidTitle);
      return;
    }
    if (date.length === 0) {
      setFormError(strings.calendar.invalidDate);
      return;
    }

    // Assemble startAt: all-day is the bare date; timed appends the time (09:00
    // by default) so the "YYYY-MM-DDTHH:MM" form clears the store's ISO check.
    const effectiveTime = time || "09:00";
    const trimmedLocation = location.trim();
    const trimmedEndTime = endTime.trim();

    // The store throws on an end that doesn't strictly follow the start —
    // caught after the fact isn't good enough, so a bad pair never leaves
    // this form at all.
    if (!allDay && trimmedEndTime.length > 0 && trimmedEndTime <= effectiveTime) {
      setFormError(strings.calendar.endBeforeStart);
      return;
    }

    const fields: EditedEventFields = {
      title: trimmedTitle,
      date,
      time: effectiveTime,
      endTime: trimmedEndTime,
      allDay,
      startAt: allDay ? date : `${date}T${effectiveTime}`,
      // Null clears a stored end time exactly like `location` already clears —
      // but only for a timed event: all-day has no end-time field to begin
      // with, so `endAt` is left out of the payload entirely rather than
      // nulling whatever end DATE a multi-day all-day event might carry.
      endAt: !allDay && trimmedEndTime.length > 0 ? `${date}T${trimmedEndTime}` : null,
      location: trimmedLocation.length > 0 ? trimmedLocation : null,
      recurrence,
      reminderOffsets,
    };

    // Editing one occurrence of a series never picks a scope silently (PRD 04):
    // the write waits for the dialog's answer.
    if (editingId != null && editingOccurrence != null) {
      setPendingSeries({ kind: "edit", occurrence: editingOccurrence, fields });
      return;
    }

    setSaving(true);
    try {
      if (editingId != null) {
        const changes: EventFieldChanges = {
          title: fields.title,
          startAt: fields.startAt,
          allDay: fields.allDay,
          location: fields.location,
          recurrence: fields.recurrence,
          reminderOffsets: fields.reminderOffsets,
        };
        if (!fields.allDay) changes.endAt = fields.endAt;
        const updated = await window.nexus.updateEvent(profileId, editingId, changes);
        setEvents((prev) => prev && prev.map((e) => (e.id === updated.id ? updated : e)));
        resetForm();
      } else {
        const created = await window.nexus.createEvent(
          profileId,
          newEventFields(fields, fields.recurrence, null),
        );
        setEvents((prev) => (prev ? [...prev, created] : [created]));
        resetForm();
        titleRef.current?.focus();
      }
    } catch (error) {
      setFormError(strings.calendar.saveError);
      console.error("Nexus: failed to save event:", error);
    } finally {
      setSaving(false);
    }
  }

  async function remove(event: Event, occurrence: EventOccurrence | null): Promise<void> {
    // Deleting one occurrence of a series asks what "delete" means here first.
    if (occurrence !== null) {
      setPendingSeries({ kind: "delete", occurrence });
      return;
    }
    setActionError(null);
    try {
      await window.nexus.deleteEvent(profileId, event.id);
      setEvents((prev) => prev && prev.filter((current) => current.id !== event.id));
      // Never leave the form bound to an event that no longer exists.
      if (editingId === event.id) resetForm();
      // One pending undo at a time — a fresh delete replaces the previous offer.
      setPendingUndoId(event.id);
    } catch (error) {
      setActionError(strings.calendar.actionError);
      console.error("Nexus: failed to delete event:", error);
    }
  }

  // --- Series operations (ADR-024) ------------------------------------------
  //
  // All three read the same way: "Samo ovaj" excepts the occurrence's date and
  // then does whatever the user asked for on that day alone, "Ovaj i budući"
  // truncates the master there and starts a fresh one, and "Svi" edits the
  // master itself. Each finishes with a full re-fetch rather than a local
  // patch: a split at a master's first occurrence soft-deletes that master, so
  // the row set after a series operation is not something the renderer can
  // reliably guess.

  async function applyEditScope(
    scope: RecurrenceScope,
    occurrence: EventOccurrence,
    fields: EditedEventFields,
  ): Promise<void> {
    const master = occurrence.master;
    if (scope === "all") {
      // Moving this occurrence's date moves the whole series with it: the
      // master's anchor shifts by exactly the same whole-day delta.
      const masterDay = shiftDayKey(
        master.startAt.slice(0, 10),
        daysBetweenKeys(occurrence.date, fields.date),
      );
      const changes: EventFieldChanges = {
        title: fields.title,
        startAt: fields.allDay ? masterDay : `${masterDay}T${fields.time}`,
        allDay: fields.allDay,
        location: fields.location,
        recurrence: fields.recurrence,
        reminderOffsets: fields.reminderOffsets,
      };
      if (!fields.allDay) {
        changes.endAt = fields.endTime.length > 0 ? `${masterDay}T${fields.endTime}` : null;
      }
      await window.nexus.updateEvent(profileId, master.id, changes);
    } else {
      // "Samo ovaj" detaches a one-off; "Ovaj i budući" opens a new series at
      // the edited date, carrying whatever rule the picker now holds. The copy
      // is created FIRST: if the pair is interrupted between its two writes,
      // create-then-except leaves a briefly duplicated occurrence the user can
      // delete, while except-then-create would leave one silently vanished —
      // recoverable beats gone.
      await window.nexus.createEvent(
        profileId,
        newEventFields(fields, scope === "this" ? null : fields.recurrence, master),
      );
      if (scope === "this") {
        await window.nexus.addEventRecurrenceExdate(profileId, master.id, occurrence.date);
      } else {
        await window.nexus.splitEventRecurrence(profileId, master.id, occurrence.date);
      }
    }
    await reload();
    resetForm();
  }

  async function applyDeleteScope(
    scope: RecurrenceScope,
    occurrence: EventOccurrence,
  ): Promise<void> {
    const master = occurrence.master;
    if (scope === "this") {
      await window.nexus.addEventRecurrenceExdate(profileId, master.id, occurrence.date);
    } else if (scope === "future") {
      await window.nexus.splitEventRecurrence(profileId, master.id, occurrence.date);
    } else {
      await window.nexus.deleteEvent(profileId, master.id);
      // Only "Svi" is a soft delete, so it is the only one with an undo to
      // offer — an excepted or truncated series is taken back by editing it.
      setPendingUndoId(master.id);
    }
    if (editingId === master.id) resetForm();
    await reload();
  }

  async function applyMoveScope(
    scope: RecurrenceScope,
    pending: Extract<PendingSeries, { kind: "move" }>,
  ): Promise<void> {
    const master = pending.occurrence.master;
    const delta = daysBetweenKeys(pending.fromKey, pending.toKey);
    if (scope === "all") {
      // "Svi" moves the series by the same whole-day delta; a drag inside the
      // hour grid also gives it the new time of day and duration, exactly as
      // `applyEditScope`'s own "all" branch takes those from the form.
      const changes = shiftEventChanges(master, delta);
      if (pending.minutes !== null) {
        const masterDay = (changes.startAt ?? master.startAt).slice(0, 10);
        changes.startAt = `${masterDay}T${formatClock(pending.minutes.startMinutes)}`;
        changes.endAt =
          pending.minutes.endMinutes === null
            ? null
            : `${masterDay}T${formatClock(pending.minutes.endMinutes)}`;
      }
      await window.nexus.updateEvent(profileId, master.id, changes);
    } else {
      // Copied from the OCCURRENCE, not the master, so the new row keeps this
      // occurrence's own duration and time of day rather than the series'.
      // Created FIRST, for the same reason `applyEditScope` creates first: an
      // interruption between the pair then duplicates rather than vanishes.
      await window.nexus.createEvent(
        profileId,
        copyEventFields(
          pending.event,
          delta,
          scope === "this" ? null : master.recurrence,
          pending.minutes,
        ),
      );
      if (scope === "this") {
        await window.nexus.addEventRecurrenceExdate(
          profileId,
          master.id,
          pending.occurrence.date,
        );
      } else {
        await window.nexus.splitEventRecurrence(profileId, master.id, pending.occurrence.date);
      }
    }
    await reload();
  }

  async function resolveSeries(scope: RecurrenceScope): Promise<void> {
    const pending = pendingSeries;
    if (pending === null) return;
    setPendingSeries(null);
    setActionError(null);
    try {
      if (pending.kind === "edit") {
        await applyEditScope(scope, pending.occurrence, pending.fields);
      } else if (pending.kind === "delete") {
        await applyDeleteScope(scope, pending.occurrence);
      } else {
        await applyMoveScope(scope, pending);
      }
    } catch (error) {
      setActionError(strings.calendar.actionError);
      console.error("Nexus: failed to change the recurring event:", error);
    }
  }

  async function undo(): Promise<void> {
    if (!pendingUndoId) return;
    setActionError(null);
    try {
      await window.nexus.restoreEvent(profileId, pendingUndoId);
      setPendingUndoId(null);
      // Re-fetch so the restored event lands back in chronological order.
      await reload();
    } catch (error) {
      setActionError(strings.calendar.actionError);
      console.error("Nexus: failed to restore event:", error);
    }
  }

  /** A month-grid drag finished on `dayKey`: shift an event's date part (time preserved), or retarget a task's due date. */
  async function moveItem(item: CalendarItem, dayKey: string): Promise<void> {
    if (item.kind === "event") {
      const delta = daysBetweenKeys(item.startKey, dayKey);
      if (delta === 0) return;
      // Dragging one occurrence somewhere else is an edit, so it asks the same
      // question an edit does rather than quietly moving the whole series.
      if (item.occurrence !== null) {
        setPendingSeries({
          kind: "move",
          occurrence: item.occurrence,
          event: item.event,
          fromKey: item.startKey,
          toKey: dayKey,
          minutes: null,
        });
        return;
      }
      setActionError(null);
      try {
        const updated = await window.nexus.updateEvent(
          profileId,
          item.event.id,
          shiftEventChanges(item.event, delta),
        );
        setEvents((prev) => prev && prev.map((e) => (e.id === updated.id ? updated : e)));
      } catch (error) {
        setActionError(strings.calendar.actionError);
        console.error("Nexus: failed to move event:", error);
      }
      return;
    }
    if (item.kind === "task") {
      if (item.startKey === dayKey) return;
      setActionError(null);
      try {
        const updated = await window.nexus.updateTask(profileId, item.task.id, { dueDate: dayKey });
        setTasks((prev) => prev && prev.map((t) => (t.id === updated.id ? updated : t)));
      } catch (error) {
        setActionError(strings.calendar.actionError);
        console.error("Nexus: failed to move task:", error);
      }
    }
  }

  /**
   * A pointer drag inside the week/day hour grid finished (ADR-034): the event
   * now occupies exactly `target`. The same three-way question a day-drag asks
   * of an occurrence is asked here too — the only difference is that the answer
   * carries minutes as well as a day.
   *
   * A one-off writes straight through and then re-reads, never optimistically:
   * the block stays where it was until the store says otherwise.
   */
  async function moveTimedEvent(item: TimedEventItem, target: TimedEventDragTarget): Promise<void> {
    const changes = timedDragChanges(item.event, target);
    if (changes === null) return;
    if (item.occurrence !== null) {
      setPendingSeries({
        kind: "move",
        occurrence: item.occurrence,
        event: item.event,
        fromKey: item.startKey,
        toKey: target.dayKey,
        minutes: { startMinutes: target.startMinutes, endMinutes: target.endMinutes },
      });
      return;
    }
    setActionError(null);
    try {
      await window.nexus.updateEvent(profileId, item.event.id, changes);
      await reload();
    } catch (error) {
      setActionError(strings.calendar.actionError);
      console.error("Nexus: failed to move event:", error);
    }
  }

  // All seven resolve together (one Promise.all), so a single null means loading.
  const dataLoading =
    events === null ||
    tasks === null ||
    subjects === null ||
    exams === null ||
    blocks === null ||
    people === null ||
    term === null;
  const todayKey = localTodayKey();
  // The store orders by SQLite's binary collation, which mis-tailors Serbian
  // Latin script; the popover re-sorts, as every alphabetical list here does.
  const sortedTemplates = templates.slice().sort((a, b) => collator.compare(a.name, b.name));

  // Every grid view derives from the one anchor day; cheap to compute all three
  // unconditionally rather than branch on `view` twice below.
  const monthKey = monthKeyOf(anchorKey);
  const weekKeys = weekDayKeys(anchorKey, weekStart);
  // A SET term anchors Semestar to ITS months (ADR-054); without one the view
  // keeps the sliding anchored-month-plus-three it always had.
  const semesterMonths =
    activeTerm !== null
      ? termMonthKeys(activeTerm.start, activeTerm.end)
      : semesterMonthKeys(monthKey);
  // A span past the cap renders its first six and says so in a caption — the
  // last rendered month falling short of the end's month is exactly that case.
  const termTruncated =
    activeTerm !== null && (semesterMonths.at(-1) ?? "") < monthKeyOf(activeTerm.end);
  const isGridView =
    view === "mesec" || view === "nedelja" || view === "dan" || view === "semestar";

  // How far a recurring master is expanded (ADR-024): exactly what this view can
  // show, so no view pays for another's reach. The agenda has no bounds of its
  // own, so it borrows the study-block window — the horizon this page already
  // treats as "the part of the calendar worth loading".
  const expansionRange: CalendarRange =
    view === "mesec"
      ? {
          from: shiftDayKey(`${monthKey}-01`, -MONTH_RANGE_BEFORE),
          to: shiftDayKey(`${monthKey}-01`, MONTH_RANGE_AFTER),
        }
      : view === "nedelja"
        ? { from: weekKeys[0] ?? anchorKey, to: weekKeys[6] ?? anchorKey }
        : view === "dan"
          ? { from: anchorKey, to: anchorKey }
          : // Semestar reaches furthest of all — its whole rendered span (the
            // term's months when one is set, the sliding four otherwise), and
            // it is merged ONCE over that span rather than a month at a time.
            view === "semestar"
            ? monthsRange(semesterMonths)
            : {
                from: shiftDayKey(todayKey, -BLOCKS_PAST_DAYS),
                to: shiftDayKey(todayKey, BLOCKS_FUTURE_DAYS),
              };

  // CAL-005 / ADR-058 §5: the other profile's events for the visible range —
  // fetched only while the chip is ON and there is another profile at all, so
  // a switched-off overlay costs nothing and no foreign row ever reaches this
  // renderer unasked (data minimization starts at the fetch). Keyed on the
  // range's CONTENT, not the object: `expansionRange` is rebuilt every render.
  const overlayOn = overlayProfile !== null && sources.has("overlay") && !isPanelView(view);
  useEffect(() => {
    if (!overlayOn) {
      setOverlay([]);
      setOverlayFailed(false);
      return;
    }
    let active = true;
    void (async () => {
      try {
        const rows = await window.nexus.calendarOverlay(
          profileId,
          expansionRange.from,
          expansionRange.to,
        );
        if (!active) return;
        setOverlay(rows);
        setOverlayFailed(false);
      } catch (error) {
        if (active) setOverlayFailed(true);
        console.error("Nexus: failed to load the calendar overlay:", error);
      }
    })();
    return () => {
      active = false;
    };
  }, [profileId, overlayOn, expansionRange.from, expansionRange.to]);

  // FIN slice d: the renewals the subscriptions' RULES place in the visible
  // range — the same arrangement the overlay above uses, and for the same
  // reason: main expands the rules (`FinRecurringStore.upcoming`), so the merge
  // below only derives keys. Fetched only while the chip is ON, so a profile
  // that keeps no subscriptions pays nothing for the source.
  const renewalsOn = sources.has("subscriptions") && !isPanelView(view);
  useEffect(() => {
    if (!renewalsOn) {
      setRenewals([]);
      return;
    }
    let active = true;
    void (async () => {
      try {
        const rows = await window.nexus.finUpcomingRenewals(profileId, {
          from: expansionRange.from,
          to: expansionRange.to,
        });
        if (active) setRenewals(rows);
      } catch (error) {
        // Quiet, unlike the overlay's own banner: a missing renewal row costs
        // one chip's worth of information, and the ledger is where the money
        // actually is.
        console.error("Nexus: failed to load the upcoming renewals:", error);
      }
    })();
    return () => {
      active = false;
    };
  }, [profileId, renewalsOn, expansionRange.from, expansionRange.to]);

  const calendarItems = dataLoading
    ? []
    : buildCalendarItems(
        { events, tasks, exams, blocks, subjects, people, overlay, renewals },
        sources,
        expansionRange,
      );
  // Only Semestar reads density, and it reads it off that single merge.
  const dayDensity = view === "semestar" ? buildDayDensity(calendarItems) : EMPTY_DENSITY;
  const periodLabel =
    view === "mesec"
      ? formatMonthLabel(monthKey)
      : view === "nedelja"
        ? formatWeekLabel(weekKeys)
        : view === "dan"
          ? formatDayLabel(anchorKey)
          : view === "semestar"
            ? formatSemesterLabel(semesterMonths)
            : "";

  return (
    <div className="cal">
      <PageHeader title={moduleName("calendar")} />
      {pendingSeries !== null && (
        <RecurrenceScopeDialog
          action={pendingSeries.kind === "delete" ? "delete" : "edit"}
          onChoose={(scope) => void resolveSeries(scope)}
          onCancel={() => setPendingSeries(null)}
        />
      )}

      {/* The origin popover a foreign item opens (CAL-005): headed by the
          origin profile's own name, one sentence on why the event cannot be
          opened here, and the one action that makes sense — the SAME
          passcode-gated switch every profile change passes (AUTH-024), lifted
          to App through onSwitchToProfile. Reuses NotePopover's panel classes
          so the two cannot drift visually. */}
      {foreignAnchor !== null &&
        overlayProfile !== null &&
        foreignPopover.portal(
          <div
            className="note__menu-panel"
            role="menu"
            aria-label={strings.calendar.overlay.popoverLabel}
            // A menu is not a modal (WAI-ARIA APG): Tab closes it and moves
            // on, matching `notePopover.tsx`'s own menus, rather than
            // leaving it open with focus already gone.
            onKeyDown={(event) => {
              if (event.key === "Tab") setForeignAnchor(null);
            }}
            {...foreignPopover.panelProps}
          >
            <span className="note__menu-label">{profileDisplayName(overlayProfile)}</span>
            <p className="note__menu-caption">{strings.calendar.overlay.originNote}</p>
            <button
              className="note__menu-item"
              role="menuitem"
              type="button"
              onClick={() => {
                setForeignAnchor(null);
                onSwitchToProfile(overlayProfile);
              }}
            >
              {strings.calendar.overlay.switchAction}
            </button>
          </div>,
        )}

      {/* Both switcher rows carry a VISIBLE label now. They had identical
          treatments and sat directly on top of each other, so „which view"
          and „which calendars" looked like one control that had wrapped —
          the only thing telling them apart was an `aria-label` nobody sees
          (STATUS §5 C item 15). */}
      <div className="cal__views" role="group" aria-labelledby="cal-views-label">
        <span className="cal__reminders-label" id="cal-views-label">
          {strings.calendar.viewLabel}
        </span>
        {CALENDAR_VIEWS.map((option) => (
          <Button
            key={option}
            size="sm"
className="nx-segmented__option cal__view"
            aria-pressed={view === option}
            onClick={() => selectView(option)}
          >
            {VIEW_LABEL[option]}
          </Button>
        ))}
      </div>

      {!isPanelView(view) && (
        <div className="cal__sources" role="group" aria-labelledby="cal-sources-label">
          <span className="cal__reminders-label" id="cal-sources-label">
            {strings.calendar.sourcesLabel}
          </span>
          {CALENDAR_SOURCES
            // The overlay chip exists only when the account has another
            // profile to overlay (CAL-005) — with one profile there is
            // nothing for it to say.
            .filter((source) => source !== "overlay" || overlayProfile !== null)
            .map((source) => (
              <Button
                key={source}
                size="sm"
className="nx-segmented__option cal__source"
                aria-pressed={sources.has(source)}
                onClick={() => toggleSource(source)}
              >
                {source === "overlay"
                  ? // Labelled by what it SHOWS: the OTHER profile's calendar.
                    overlayProfile?.kind === "business"
                    ? strings.calendar.sourceOverlayBusiness
                    : strings.calendar.sourceOverlayPrivate
                  : SOURCE_LABEL[source]}
              </Button>
            ))}
        </div>
      )}

      {/* Quiet, inline and non-blocking: the profile's own calendar is
          unaffected by an overlay fetch failing — the guests just say why
          they are missing. */}
      {overlayFailed && overlayOn && (
        <p className="app__muted" role="status">
          {strings.calendar.overlay.loadError}
        </p>
      )}

      {view === "dokumenta" ? (
        <DocumentsPanel
          profileId={profileId}
          revealDocumentId={intent?.kind === "reveal-document" ? intent.documentId : null}
          onRevealHandled={onIntentHandled}
        />
      ) : view === "ljudi" ? (
        <PeoplePanel profileId={profileId} />
      ) : (
        <>
          <form className="cal__form" onSubmit={submitForm}>
            <input
              ref={titleRef}
              className="nx-textfield__input cal__title"
              value={title}
              placeholder={strings.calendar.titlePlaceholder}
              aria-label={strings.calendar.titleLabel}
              autoFocus
              onChange={(event: ChangeEvent<HTMLInputElement>) => setTitle(event.target.value)}
            />
            <TextField
              type="date"
              value={date}
              required
              aria-label={strings.calendar.dateLabel}
              onChange={(event) => {
                const next = event.target.value;
                setDate(next);
                // A rule has to phase from a real day, so clearing the date
                // clears the rule where the user can see it happen, rather than
                // dropping it silently at submit time.
                if (!isValidDayKey(next)) setRecurrence(null);
              }}
            />
            {!allDay && (
              <>
                {/* Both fields stay `type="time"`: the system draws those, so
                    the clock preference (CAL §5) reaches every calendar LABEL
                    and deliberately none of the inputs — their value is the
                    24-hour "HH:MM" the store is given either way. */}
                <TextField
                  type="time"
                  value={time}
                  aria-label={strings.calendar.timeLabel}
                  onChange={(event) => {
                    const next = event.target.value;
                    setTime(next);
                    // CAL §5: an end the form seeded follows the start; one the
                    // user typed is never overwritten.
                    if (!endTimeTouched) setEndTime(seedEndTime(next));
                  }}
                />
                <TextField
                  type="time"
                  value={endTime}
                  aria-label={strings.calendar.endTimeLabel}
                  onChange={(event) => {
                    setEndTime(event.target.value);
                    setEndTimeTouched(true);
                  }}
                />
              </>
            )}
            <TextField
              type="text"
              value={location}
              placeholder={strings.calendar.locationPlaceholder}
              aria-label={strings.calendar.locationLabel}
              onChange={(event) => setLocation(event.target.value)}
            />
            <Checkbox checked={allDay} onChange={(event) => setAllDay(event.target.checked)}>
              {strings.calendar.allDay}
            </Checkbox>
            {/* Keyed by the record being edited: switching events re-derives
                whether the rule reads as a preset or as Prilagođeno. */}
            <RecurrencePicker
              key={editingId ?? "new"}
              value={recurrence}
              onChange={setRecurrence}
              anchor={date}
            />
            <div className="cal__reminders">
              <span className="cal__reminders-label">{strings.calendar.reminders.label}</span>
              <div
                className="cal__reminder-chips"
                role="group"
                aria-label={strings.calendar.reminders.label}
              >
                {reminderChoices(reminderOffsets).map((minutes) => {
                  const selected = reminderOffsets.includes(minutes);
                  return (
                    <Button
                      key={minutes}
                      size="sm"
                      className="nx-segmented__option cal__reminder"
                      aria-pressed={selected}
                      onClick={() => toggleReminder(minutes)}
                    >
                      {reminderLabel(minutes)}
                    </Button>
                  );
                })}
              </div>
            </div>
            <Button type="submit" variant="primary" disabled={saving}>
              {editingId != null ? strings.calendar.save : strings.calendar.add}
            </Button>
            {editingId != null && (
              <Button type="button" className="cal__cancel" onClick={resetForm}>
                {strings.calendar.cancel}
              </Button>
            )}
            {/* Šabloni (CAL-009), in the form's own action row because the form
                IS this page's per-event surface: creating offers the list, and
                an event open for editing offers to become one. Nothing inside
                either panel is a `<form>` or a submit button — they sit inside
                this one, and a nested form is not a thing HTML has. */}
            {editingId === null ? (
              // `menu={false}`: each row carries a SECOND, non-menuitem
              // control (the „×" delete button below) beside the apply
              // action — a real `role="menu"` admits only menuitems (and
              // separators), so claiming the role here would promise
              // ArrowUp/Down roving focus over a list that is not
              // exclusively menuitems. An honest labelled group instead.
              <NotePopover
                menu={false}
                label={strings.calendar.templates.menuLabel}
                triggerClassName="cal__templates-trigger"
                triggerContent={strings.calendar.templates.title}
              >
                {(close) => (
                  <>
                    <span className="note__menu-label">{strings.calendar.templates.title}</span>
                    {/* A template carries no date, so the day it lands on is
                        named out loud rather than left to be discovered. */}
                    <p className="note__menu-caption">
                      {strings.calendar.templates.applyDayLabel}: {formatDay(templateDay)}
                    </p>
                    {sortedTemplates.length === 0 ? (
                      <p className="note__menu-caption">{strings.calendar.templates.empty}</p>
                    ) : (
                      sortedTemplates.map((template) => (
                        <div key={template.id} className="cal__template-row">
                          <button
                            className="note__menu-item cal__template-apply"
                            type="button"
                            title={strings.calendar.templates.applyTitle}
                            onClick={() => void applyTemplate(template, close)}
                          >
                            {template.name}
                          </button>
                          <button
                            className="cal__template-delete"
                            type="button"
                            aria-label={strings.calendar.templates.delete}
                            onClick={() => void deleteTemplate(template.id)}
                          >
                            ×
                          </button>
                        </div>
                      ))
                    )}
                    {templateFailed && (
                      <p className="note__menu-caption" role="status">
                        {strings.calendar.templates.actionError}
                      </p>
                    )}
                  </>
                )}
              </NotePopover>
            ) : (
              // `menu={false}`: naming a template swaps this panel's content
              // for a form (a text field plus Save/Cancel) — never a
              // `role="menu"`'s business, so the honest role holds for both
              // of the panel's states rather than switching underneath it.
              <NotePopover
                menu={false}
                label={strings.calendar.templates.saveMenuLabel}
                triggerClassName="cal__template-menu"
              >
                {(close) => (
                  <>
                    <span className="note__menu-label">{strings.calendar.templates.title}</span>
                    {templateNaming ? (
                      <>
                        <div className="cal__template-form">
                          <TextField
                            value={templateDraft}
                            placeholder={strings.calendar.templates.namePlaceholder}
                            aria-label={strings.calendar.templates.nameLabel}
                            maxLength={MAX_EVENT_TEMPLATE_NAME_LENGTH}
                            autoFocus
                            onChange={(field) => setTemplateDraft(field.target.value)}
                            onKeyDown={(key: KeyboardEvent<HTMLInputElement>) => {
                              // This line lives INSIDE the event form, so Enter
                              // would otherwise submit that form instead of
                              // naming the template.
                              if (key.key === "Enter") {
                                key.preventDefault();
                                void submitSaveTemplate(editingId, close);
                              } else if (key.key === "Escape") {
                                key.preventDefault();
                                closeTemplatePrompt();
                              }
                            }}
                          />
                          <Button
                            type="button"
                            size="sm"
                            variant="primary"
                            onClick={() => void submitSaveTemplate(editingId, close)}
                          >
                            {strings.calendar.save}
                          </Button>
                          <Button type="button" size="sm" onClick={closeTemplatePrompt}>
                            {strings.calendar.cancel}
                          </Button>
                        </div>
                        {/* Said before the fact: saving under a name that exists
                            is how a template is EDITED, not an accident to warn
                            about afterwards (the ADR-016 wording precedent). */}
                        <p className="note__menu-caption">
                          {strings.calendar.templates.overwriteNote}
                        </p>
                      </>
                    ) : (
                      <button
                        className="note__menu-item"
                        type="button"
                        onClick={() => beginSaveTemplate(title)}
                      >
                        {strings.calendar.templates.saveAs}
                      </button>
                    )}
                    {templateFailed && (
                      <p className="note__menu-caption" role="status">
                        {strings.calendar.templates.actionError}
                      </p>
                    )}
                  </>
                )}
              </NotePopover>
            )}
            {formError != null && (
              <p className="cal__form-error" role="alert">
                {formError}
              </p>
            )}
          </form>

          {pendingUndoId != null && (
            <div className="cal__undo" role="status">
              <span className="cal__undo-text">{strings.calendar.deletedNotice}</span>
              <Button size="sm" className="cal__undo-action" onClick={() => void undo()}>
                {strings.calendar.undo}
              </Button>
              <Button
                size="sm"
                className="cal__undo-dismiss"
                aria-label={strings.calendar.dismiss}
                onClick={() => setPendingUndoId(null)}
              >
                ×
              </Button>
            </div>
          )}

          {actionError != null && (
            <p className="cal__form-error" role="status">
              {actionError}
            </p>
          )}

          {failed ? (
            <EmptyState
              title={strings.calendar.emptyTitle}
              description={strings.calendar.loadError}
            />
          ) : dataLoading ? (
            <LoadingState label={strings.app.loading} rows={6} />
          ) : isGridView ? (
            <div className="cal__month" onKeyDown={handleGridKeyDown}>
              <div className="cal__month-nav">
                <span className="cal__month-label">{periodLabel}</span>
                <span className="cal__month-nav-actions">
                  {/* A SET term does not slide (ADR-054): Semestar is anchored
                      to its dates, so the month arrows are disabled there —
                      and only there. */}
                  <Button
                    size="sm"
                    aria-label={strings.calendar.prevPeriod}
                    disabled={view === "semestar" && activeTerm !== null}
                    onClick={() => shiftPeriod(-1)}
                  >
                    ‹
                  </Button>
                  <Button size="sm" onClick={goToday}>
                    {strings.calendar.today}
                  </Button>
                  <Button
                    size="sm"
                    aria-label={strings.calendar.nextPeriod}
                    disabled={view === "semestar" && activeTerm !== null}
                    onClick={() => shiftPeriod(1)}
                  >
                    ›
                  </Button>
                </span>
              </div>
              {view === "mesec" ? (
                <CalendarMonth
                  monthKey={monthKey}
                  todayKey={todayKey}
                  weekStart={weekStart}
                  clock={clock}
                  items={calendarItems}
                  onSelectDay={selectDay}
                  onOpenDay={openDay}
                  onEditEvent={startEdit}
                  onOpenPeople={() => selectView("ljudi")}
                  onOpenForeign={openForeignPopover}
                  onMoveItem={(item, dayKey) => void moveItem(item, dayKey)}
                />
              ) : view === "semestar" ? (
                /* An overview and nothing else (CAL-010): no drag, no
                   creating, no editor — the one thing a mini day does is open
                   the Dan view, through the very same `openDay` the month
                   grid's day numbers and the week grid's headers use. */
                <>
                  <div
                    className="cal__semester"
                    role="group"
                    tabIndex={0}
                    aria-label={strings.calendar.semester.regionLabel}
                  >
                    {semesterMonths.map((key) => (
                      <CalendarMiniMonth
                        key={key}
                        monthKey={key}
                        todayKey={todayKey}
                        weekStart={weekStart}
                        density={dayDensity}
                        term={activeTerm}
                        onOpenDay={openDay}
                      />
                    ))}
                  </div>
                  <p className="cal__semester-legend">{strings.calendar.semester.legend}</p>
                  {/* The term has edges (ADR-054): a span past six months
                      renders its first six and says so; no term at all earns
                      one quiet line naming where the dates are set — plain
                      text, since no caption here navigates. */}
                  {termTruncated && (
                    <p className="cal__semester-legend">{strings.calendar.semester.truncated}</p>
                  )}
                  {activeTerm === null && (
                    <p className="cal__semester-legend">{strings.calendar.semester.unsetHint}</p>
                  )}
                </>
              ) : (
                <CalendarTimeGrid
                  dayKeys={view === "nedelja" ? weekKeys : [anchorKey]}
                  todayKey={todayKey}
                  clock={clock}
                  items={calendarItems}
                  onSelectSlot={selectSlot}
                  onOpenDay={openDay}
                  onEditEvent={startEdit}
                  onOpenPeople={() => selectView("ljudi")}
                  onOpenForeign={openForeignPopover}
                  onMoveTimedEvent={(item, target) => void moveTimedEvent(item, target)}
                />
              )}
            </div>
          ) : calendarItems.length === 0 ? (
            <EmptyState
              title={strings.calendar.emptyTitle}
              description={strings.calendar.emptyDescription}
            />
          ) : (
            <div className="cal__agenda">
              {groupAgenda(calendarItems).map(([key, dayItems]) => (
                <section key={key} className="cal__day">
                  <h2 className="cal__day-header">{formatDay(key)}</h2>
                  {dayItems.map((item) => {
                    if (item.kind === "event") {
                      return (
                        <ListRow
                          key={item.id}
                          leading={<span className="cal__time">{formatTime(item.event, clock)}</span>}
                          trailing={
                            <span className="cal__row-actions">
                              <Button
                                size="sm"
                                className="cal__edit"
                                aria-label={strings.calendar.editLabel}
                                onClick={() => startEdit(item.event, item.occurrence)}
                              >
                                ✎
                              </Button>
                              <Button
                                size="sm"
                                className="cal__delete"
                                aria-label={strings.calendar.deleteLabel}
                                onClick={() => void remove(item.event, item.occurrence)}
                              >
                                ×
                              </Button>
                            </span>
                          }
                        >
                          <span className="cal__event">
                            {item.occurrence !== null && <RecurrenceMark />}
                            <span className="cal__event-title">{item.event.title}</span>
                            {item.event.location ? (
                              <Chip variant="data">{item.event.location}</Chip>
                            ) : null}
                          </span>
                        </ListRow>
                      );
                    }
                    // Foreign row (CAL-005): a read-only guest. No edit, no
                    // delete — the „⋯“ opens the origin popover, whose one
                    // action is the passcode-gated profile switch.
                    if (item.kind === "foreign") {
                      return (
                        <ListRow
                          key={item.id}
                          muted
                          leading={
                            <span className="cal__time">{formatTime(item.foreign, clock)}</span>
                          }
                          trailing={
                            <Button
                              size="sm"
                              className="cal__foreign-origin"
                              aria-label={strings.calendar.overlay.popoverLabel}
                              onClick={(e) =>
                                openForeignPopover(e.currentTarget.getBoundingClientRect())
                              }
                            >
                              ⋯
                            </Button>
                          }
                        >
                          <span className="cal__event">
                            <ForeignMark />
                            <span className="cal__event-title">{item.foreign.title}</span>
                          </span>
                        </ListRow>
                      );
                    }
                    // Birthday row (CAL-007): read-only, like every other
                    // non-event source here — a person is edited in the Ljudi
                    // panel, never from a calendar surface.
                    if (item.kind === "birthday") {
                      return (
                        <ListRow key={item.id} leading={<span className="cal__time" />}>
                          <span className="cal__event">
                            <Chip className="cal__birthday-tag">
                              {strings.calendar.people.kind[item.person.kind]}
                            </Chip>
                            <span className="cal__event-title">{item.person.name}</span>
                            {item.age !== null && (
                              <Chip variant="data">
                                {item.age} {strings.calendar.people.yearsUnit}
                              </Chip>
                            )}
                          </span>
                        </ListRow>
                      );
                    }
                    if (item.kind === "task") {
                      return (
                        <ListRow
                          key={item.id}
                          muted={item.task.done}
                          leading={<span className="cal__time" />}
                        >
                          <span className="cal__event">
                            <Chip className="cal__task-tag">{strings.calendar.taskTag}</Chip>
                            <span className="cal__event-title">{item.task.title}</span>
                          </span>
                        </ListRow>
                      );
                    }
                    // Renewal row (FIN slice d): read-only, like every other
                    // non-event source here — a subscription is edited on the
                    // Finansije page, never from a calendar surface. What is
                    // drawn comes from the RULE, so a day in the future shows
                    // what WILL be charged rather than a row that already is.
                    if (item.kind === "subscription") {
                      return (
                        <ListRow
                          key={item.id}
                          leading={<span className="cal__time" />}
                          trailing={
                            <Chip variant="data">
                              {formatMoney(item.renewal.amount, item.renewal.currency)}
                            </Chip>
                          }
                        >
                          <span className="cal__event">
                            <Chip className="cal__subscription-tag">
                              {strings.calendar.subscriptionTag}
                            </Chip>
                            <span className="cal__event-title">{item.renewal.name}</span>
                          </span>
                        </ListRow>
                      );
                    }
                    if (item.kind === "exam") {
                      const days = daysUntilExam(item.exam.examDate);
                      return (
                        <ListRow
                          key={item.id}
                          muted={days < 0}
                          leading={
                            <span className="cal__time cal__exam-time">
                              <span
                                className={`study__dot study__dot--${item.subject.color}`}
                                aria-hidden="true"
                              />
                            </span>
                          }
                          trailing={
                            <Chip variant={examCountdownVariant(days)}>
                              {examCountdownLabel(days)}
                            </Chip>
                          }
                        >
                          <span className="cal__event">
                            <Chip className="cal__exam-tag">{strings.study.calendarTag}</Chip>
                            <span className="cal__event-title">
                              {item.subject.name} — {strings.study.examType[item.exam.examType]}
                            </span>
                            {item.exam.scope ? <Chip variant="data">{item.exam.scope}</Chip> : null}
                          </span>
                        </ListRow>
                      );
                    }
                    // Study-block row (STUDY-003): read-only — check-off lives on StudyPage.
                    const status = item.block.status;
                    return (
                      <ListRow
                        key={item.id}
                        muted={status === "missed"}
                        leading={
                          <span className="cal__time cal__exam-time">
                            <span
                              className={`study__dot study__dot--${item.subject.color}`}
                              aria-hidden="true"
                            />
                          </span>
                        }
                        trailing={
                          status === "planned" ? undefined : (
                            <Chip variant={status === "done" ? "data" : "neutral"}>
                              {strings.study.blockStatus[status]}
                            </Chip>
                          )
                        }
                      >
                        <span className="cal__event">
                          <Chip className="cal__block-tag">{strings.study.planCalendarTag}</Chip>
                          <span className="cal__event-title">
                            {item.subject.name} — {strings.study.examType[item.exam.examType]}
                          </span>
                          {/* The block's topic and kind, quietly (ADR-063) — the
                              row stays read-only; check-off lives on StudyPage. */}
                          {item.block.topicId !== null && topicNames.has(item.block.topicId) && (
                            <span className="cal__block-topic">
                              {topicNames.get(item.block.topicId)}
                            </span>
                          )}
                          {item.block.kind !== "coverage" && (
                            <Chip>{strings.study.blockKind[item.block.kind]}</Chip>
                          )}
                          <Chip>
                            {item.block.minutes} {strings.study.minutesUnit}
                          </Chip>
                        </span>
                      </ListRow>
                    );
                  })}
                </section>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
