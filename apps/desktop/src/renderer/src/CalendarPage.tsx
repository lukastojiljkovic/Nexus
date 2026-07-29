import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, KeyboardEvent } from "react";
import { Button, Checkbox, Chip, EmptyState, ListRow, TextField } from "@nexus/ui";
import { isValidDayKey, monthKeyOf, shiftDayKey, shiftMonthKey, weekDayKeys } from "@nexus/core";
import type {
  Event,
  EventFieldChanges,
  Exam,
  NewEventFields,
  Person,
  RecurrenceRule,
  StudyBlockWithExam,
  Subject,
  Task,
} from "../../shared/ipc.js";
import { CalendarMonth } from "./CalendarMonth.js";
import { CalendarTimeGrid } from "./CalendarTimeGrid.js";
import {
  buildCalendarItems,
  CALENDAR_SOURCES,
  daysBetweenKeys,
  formatClock,
  persistSources,
  readStoredSources,
} from "./calendarItems.js";
import type {
  CalendarItem,
  CalendarRange,
  CalendarSource,
  EventOccurrence,
} from "./calendarItems.js";
import { RecurrenceMark, RecurrencePicker } from "./RecurrencePicker.js";
import { RecurrenceScopeDialog } from "./RecurrenceScopeDialog.js";
import type { RecurrenceScope } from "./RecurrenceScopeDialog.js";
import { DocumentsPanel } from "./DocumentsPanel.js";
import { PeoplePanel } from "./PeoplePanel.js";
import { daysUntilExam, examCountdownLabel, examCountdownVariant, localTodayKey } from "./examDates.js";
import { dayUnit, strings } from "./strings.js";

// --- Per-profile view memory (interim, mirrors TasksPage) -------------------
//
// Mesec / Nedelja / Dan / Agenda / Dokumenta / Ljudi is a lightweight UI
// preference, persisted per profile in localStorage exactly like the tasks
// list/kanban toggle.
type CalendarView = "mesec" | "nedelja" | "dan" | "agenda" | "dokumenta" | "ljudi";
const VIEW_KEY_PREFIX = "nexus.calendar.view.";
/** Monday-first, the Serbian default (mirrors CalendarMonth's own WEEK_START). */
const WEEK_START = 1;

/** The two views that replace the whole event surface with a panel of their own. */
function isPanelView(view: CalendarView): boolean {
  return view === "dokumenta" || view === "ljudi";
}

function readStoredView(profileId: string): CalendarView {
  const raw = localStorage.getItem(VIEW_KEY_PREFIX + profileId);
  return raw === "nedelja" ||
    raw === "dan" ||
    raw === "agenda" ||
    raw === "dokumenta" ||
    raw === "ljudi"
    ? raw
    : "mesec";
}
function persistView(profileId: string, view: CalendarView): void {
  localStorage.setItem(VIEW_KEY_PREFIX + profileId, view);
}

const SOURCE_LABEL: Record<CalendarSource, string> = {
  events: strings.calendar.sourceEvents,
  tasks: strings.calendar.sourceTasks,
  exams: strings.calendar.sourceExams,
  blocks: strings.calendar.sourceBlocks,
  birthdays: strings.calendar.sourceBirthdays,
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
  birthday: 1,
  task: 2,
  exam: 3,
  block: 4,
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

/** Row time label — "Ceo dan" for all-day, else HH:MM; raw start on bad input. */
function formatTime(event: Event): string {
  if (event.allDay) return strings.calendar.allDay;
  const date = new Date(event.startAt);
  return Number.isNaN(date.getTime())
    ? event.startAt
    : new Intl.DateTimeFormat("sr-Latn", { hour: "2-digit", minute: "2-digit" }).format(date);
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
 * A series operation waiting on the "Samo ovaj / Ovaj i budući / Svi" answer.
 * Each variant carries everything its own branch needs, so the dialog's answer
 * is all that is still missing when it arrives.
 */
type PendingSeries =
  | { kind: "edit"; occurrence: EventOccurrence; fields: EditedEventFields }
  | { kind: "delete"; occurrence: EventOccurrence }
  | { kind: "move"; occurrence: EventOccurrence; event: Event; fromKey: string; toKey: string };

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

/** A full copy of an event moved `delta` whole days — what a detached occurrence or a new series master is created from. */
function copyEventFields(
  event: Event,
  delta: number,
  rule: RecurrenceRule | null,
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
  return payload;
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
 */
export function CalendarPage({ profileId, intent, onIntentHandled }: CalendarPageProps) {
  const [events, setEvents] = useState<Event[] | null>(null);
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [subjects, setSubjects] = useState<Subject[] | null>(null);
  const [exams, setExams] = useState<Exam[] | null>(null);
  const [blocks, setBlocks] = useState<StudyBlockWithExam[] | null>(null);
  const [people, setPeople] = useState<Person[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<CalendarView>(() => readStoredView(profileId));
  const [sources, setSources] = useState<ReadonlySet<CalendarSource>>(() =>
    readStoredSources(profileId),
  );
  // The single anchor day every grid view derives from: the month view takes
  // its month, the week view its Monday-first week, the day view the key
  // itself — so "Danas" and the keyboard shortcuts have exactly one thing to
  // reset regardless of which of the three is showing.
  const [anchorKey, setAnchorKey] = useState<string>(() => localTodayKey());
  const [pendingUndoId, setPendingUndoId] = useState<string | null>(null);

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
  const [location, setLocation] = useState("");
  const [recurrence, setRecurrence] = useState<RecurrenceRule | null>(null);
  const [reminderOffsets, setReminderOffsets] = useState<number[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [pendingSeries, setPendingSeries] = useState<PendingSeries | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        // Sync every study plan first so past blocks are already labelled
        // `missed` when the agenda/grid reads them.
        await window.nexus.syncAllPlans(profileId);
        const today = localTodayKey();
        const [nextEvents, nextTasks, nextSubjects, nextExams, nextBlocks, nextPeople] =
          await Promise.all([
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
          ]);
        if (!active) return;
        setEvents(nextEvents);
        setTasks(nextTasks);
        setSubjects(nextSubjects);
        setExams(nextExams);
        setBlocks(nextBlocks);
        setPeople(nextPeople);
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

  function resetForm(): void {
    setEditingId(null);
    setEditingOccurrence(null);
    setTitle("");
    setAllDay(false);
    setDate("");
    setTime("");
    setEndTime("");
    setLocation("");
    setRecurrence(null);
    setReminderOffsets([]);
    setFormError(null);
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

  /** Click on empty hour-grid space (week/day view): prefill date, a default hour-long span, and focus the title. */
  function selectSlot(dayKey: string, minutes: number): void {
    resetForm();
    setDate(dayKey);
    setTime(formatClock(minutes));
    setEndTime(formatClock(Math.min(minutes + 60, 23 * 60 + 59)));
    titleRef.current?.focus();
  }

  /** Click on a column header (week/day) or a month day-number: jump to that day's Dan view. */
  function openDay(dayKey: string): void {
    setAnchorKey(dayKey);
    selectView("dan");
  }

  function shiftPeriod(delta: number): void {
    setAnchorKey((prev) => {
      if (view === "mesec") return `${shiftMonthKey(monthKeyOf(prev), delta)}-01`;
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

  async function submitForm(formEvent: FormEvent<HTMLFormElement>): Promise<void> {
    formEvent.preventDefault();
    const trimmedTitle = title.trim();
    if (trimmedTitle.length === 0 || date.length === 0) return;

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
      console.error("Nexus: failed to save event:", error);
    }
  }

  async function remove(event: Event, occurrence: EventOccurrence | null): Promise<void> {
    // Deleting one occurrence of a series asks what "delete" means here first.
    if (occurrence !== null) {
      setPendingSeries({ kind: "delete", occurrence });
      return;
    }
    try {
      await window.nexus.deleteEvent(profileId, event.id);
      setEvents((prev) => prev && prev.filter((current) => current.id !== event.id));
      // Never leave the form bound to an event that no longer exists.
      if (editingId === event.id) resetForm();
      // One pending undo at a time — a fresh delete replaces the previous offer.
      setPendingUndoId(event.id);
    } catch (error) {
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
      await window.nexus.updateEvent(profileId, master.id, shiftEventChanges(master, delta));
    } else {
      // Copied from the OCCURRENCE, not the master, so the new row keeps this
      // occurrence's own duration and time of day rather than the series'.
      // Created FIRST, for the same reason `applyEditScope` creates first: an
      // interruption between the pair then duplicates rather than vanishes.
      await window.nexus.createEvent(
        profileId,
        copyEventFields(pending.event, delta, scope === "this" ? null : master.recurrence),
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
    try {
      if (pending.kind === "edit") {
        await applyEditScope(scope, pending.occurrence, pending.fields);
      } else if (pending.kind === "delete") {
        await applyDeleteScope(scope, pending.occurrence);
      } else {
        await applyMoveScope(scope, pending);
      }
    } catch (error) {
      console.error("Nexus: failed to change the recurring event:", error);
    }
  }

  async function undo(): Promise<void> {
    if (!pendingUndoId) return;
    try {
      await window.nexus.restoreEvent(profileId, pendingUndoId);
      setPendingUndoId(null);
      // Re-fetch so the restored event lands back in chronological order.
      await reload();
    } catch (error) {
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
        });
        return;
      }
      try {
        const updated = await window.nexus.updateEvent(
          profileId,
          item.event.id,
          shiftEventChanges(item.event, delta),
        );
        setEvents((prev) => prev && prev.map((e) => (e.id === updated.id ? updated : e)));
      } catch (error) {
        console.error("Nexus: failed to move event:", error);
      }
      return;
    }
    if (item.kind === "task") {
      if (item.startKey === dayKey) return;
      try {
        const updated = await window.nexus.updateTask(profileId, item.task.id, { dueDate: dayKey });
        setTasks((prev) => prev && prev.map((t) => (t.id === updated.id ? updated : t)));
      } catch (error) {
        console.error("Nexus: failed to move task:", error);
      }
    }
  }

  // All six resolve together (one Promise.all), so a single null means loading.
  const dataLoading =
    events === null ||
    tasks === null ||
    subjects === null ||
    exams === null ||
    blocks === null ||
    people === null;
  const todayKey = localTodayKey();

  // Every grid view derives from the one anchor day; cheap to compute both
  // unconditionally rather than branch on `view` twice below.
  const monthKey = monthKeyOf(anchorKey);
  const weekKeys = weekDayKeys(anchorKey, WEEK_START);
  const isGridView = view === "mesec" || view === "nedelja" || view === "dan";

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
          : {
              from: shiftDayKey(todayKey, -BLOCKS_PAST_DAYS),
              to: shiftDayKey(todayKey, BLOCKS_FUTURE_DAYS),
            };
  const calendarItems = dataLoading
    ? []
    : buildCalendarItems({ events, tasks, exams, blocks, subjects, people }, sources, expansionRange);
  const periodLabel =
    view === "mesec"
      ? formatMonthLabel(monthKey)
      : view === "nedelja"
        ? formatWeekLabel(weekKeys)
        : view === "dan"
          ? formatDayLabel(anchorKey)
          : "";

  return (
    <div className="cal">
      {pendingSeries !== null && (
        <RecurrenceScopeDialog
          action={pendingSeries.kind === "delete" ? "delete" : "edit"}
          onChoose={(scope) => void resolveSeries(scope)}
          onCancel={() => setPendingSeries(null)}
        />
      )}

      <div className="cal__views" role="group" aria-label={strings.calendar.viewLabel}>
        {(["mesec", "nedelja", "dan", "agenda", "dokumenta", "ljudi"] as const).map((option) => (
          <Button
            key={option}
            size="sm"
            className={view === option ? "cal__view cal__view--active" : "cal__view"}
            aria-pressed={view === option}
            onClick={() => selectView(option)}
          >
            {option === "mesec"
              ? strings.calendar.viewMesec
              : option === "nedelja"
                ? strings.calendar.viewNedelja
                : option === "dan"
                  ? strings.calendar.viewDan
                  : option === "agenda"
                    ? strings.calendar.viewAgenda
                    : option === "dokumenta"
                      ? strings.calendar.viewDokumenta
                      : strings.calendar.viewLjudi}
          </Button>
        ))}
      </div>

      {!isPanelView(view) && (
        <div className="cal__sources" role="group" aria-label={strings.calendar.sourcesLabel}>
          {CALENDAR_SOURCES.map((source) => (
            <Button
              key={source}
              size="sm"
              className={sources.has(source) ? "cal__source cal__source--active" : "cal__source"}
              aria-pressed={sources.has(source)}
              onClick={() => toggleSource(source)}
            >
              {SOURCE_LABEL[source]}
            </Button>
          ))}
        </div>
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
                <TextField
                  type="time"
                  value={time}
                  aria-label={strings.calendar.timeLabel}
                  onChange={(event) => setTime(event.target.value)}
                />
                <TextField
                  type="time"
                  value={endTime}
                  aria-label={strings.calendar.endTimeLabel}
                  onChange={(event) => setEndTime(event.target.value)}
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
                      className={
                        selected ? "cal__reminder cal__reminder--active" : "cal__reminder"
                      }
                      aria-pressed={selected}
                      onClick={() => toggleReminder(minutes)}
                    >
                      {reminderLabel(minutes)}
                    </Button>
                  );
                })}
              </div>
            </div>
            <Button type="submit" variant="primary">
              {editingId != null ? strings.calendar.save : strings.calendar.add}
            </Button>
            {editingId != null && (
              <Button type="button" className="cal__cancel" onClick={resetForm}>
                {strings.calendar.cancel}
              </Button>
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

          {failed ? (
            <EmptyState
              title={strings.calendar.emptyTitle}
              description={strings.calendar.loadError}
            />
          ) : dataLoading ? (
            <p className="app__muted">{strings.app.loading}</p>
          ) : isGridView ? (
            <div className="cal__month" onKeyDown={handleGridKeyDown}>
              <div className="cal__month-nav">
                <span className="cal__month-label">{periodLabel}</span>
                <span className="cal__month-nav-actions">
                  <Button
                    size="sm"
                    aria-label={strings.calendar.prevPeriod}
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
                  items={calendarItems}
                  onSelectDay={selectDay}
                  onOpenDay={openDay}
                  onEditEvent={startEdit}
                  onOpenPeople={() => selectView("ljudi")}
                  onMoveItem={(item, dayKey) => void moveItem(item, dayKey)}
                />
              ) : (
                <CalendarTimeGrid
                  dayKeys={view === "nedelja" ? weekKeys : [anchorKey]}
                  todayKey={todayKey}
                  items={calendarItems}
                  onSelectSlot={selectSlot}
                  onOpenDay={openDay}
                  onEditEvent={startEdit}
                  onOpenPeople={() => selectView("ljudi")}
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
                          leading={<span className="cal__time">{formatTime(item.event)}</span>}
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
