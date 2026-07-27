import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, KeyboardEvent } from "react";
import { Button, Checkbox, Chip, EmptyState, ListRow, TextField } from "@nexus/ui";
import { monthKeyOf, shiftDayKey, shiftMonthKey, weekDayKeys } from "@nexus/core";
import type {
  Event,
  EventFieldChanges,
  Exam,
  NewEventFields,
  StudyBlockWithExam,
  Subject,
  Task,
} from "../../shared/ipc.js";
import { CalendarMonth } from "./CalendarMonth.js";
import { CalendarTimeGrid } from "./CalendarTimeGrid.js";
import {
  buildCalendarItems,
  CALENDAR_SOURCES,
  formatClock,
  persistSources,
  readStoredSources,
} from "./calendarItems.js";
import type { CalendarItem, CalendarSource } from "./calendarItems.js";
import { DocumentsPanel } from "./DocumentsPanel.js";
import { daysUntilExam, examCountdownLabel, examCountdownVariant, localTodayKey } from "./examDates.js";
import { strings } from "./strings.js";

// --- Per-profile view memory (interim, mirrors TasksPage) -------------------
//
// Mesec / Nedelja / Dan / Agenda / Dokumenta is a lightweight UI preference,
// persisted per profile in localStorage exactly like the tasks list/kanban
// toggle.
type CalendarView = "mesec" | "nedelja" | "dan" | "agenda" | "dokumenta";
const VIEW_KEY_PREFIX = "nexus.calendar.view.";
/** Monday-first, the Serbian default (mirrors CalendarMonth's own WEEK_START). */
const WEEK_START = 1;

function readStoredView(profileId: string): CalendarView {
  const raw = localStorage.getItem(VIEW_KEY_PREFIX + profileId);
  return raw === "nedelja" || raw === "dan" || raw === "agenda" || raw === "dokumenta"
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
};

// --- Agenda grouping (page-level, not the views engine) ---------------------
//
// The store returns events ordered by startAt then id, but the create path
// appends optimistically, so the display order is re-derived here rather than
// trusted from insertion order. The rule matches the store's exactly — an
// all-day event's bare "YYYY-MM-DD" sorts before any timed start on that day.
// Tasks, exams (STUDY-002) and study blocks (STUDY-003) are merged in as
// read-only rows: their bare dates sort the same way a bare all-day date
// does, ahead of any timed event; within one bare date, kind rank keeps the
// order deterministic (events, then tasks, then exams, then blocks).
const KIND_RANK: Record<CalendarItem["kind"], number> = { event: 0, task: 1, exam: 2, block: 3 };

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

const MS_PER_DAY = 86_400_000;

/** Whole-day delta between two bare day keys, UTC-midnight math (no timezone/DST drift). */
function daysBetween(fromKey: string, toKey: string): number {
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

// Study blocks are fetched over a bounded window around today (the agenda
// itself has no explicit bounds): a month back covers recently missed blocks,
// a year ahead outruns any plannable exam distance.
const BLOCKS_PAST_DAYS = 31;
const BLOCKS_FUTURE_DAYS = 365;

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
 * The CAL module page: a month grid, an agenda, and a Dokumenta panel over one
 * shared item stream (ADR-020). The event form both adds and edits; every
 * write goes through the events:* and tasks:* IPC allowlists, so the store
 * stays the single source of truth (e.g. it validates startAt and derives
 * updatedAt). Upcoming exams (STUDY-002) and study blocks (STUDY-003) are
 * merged in as read-only rows; tasks are read-only too apart from a due-date
 * drag — editing any of them lives on their own pages.
 */
export function CalendarPage({ profileId, intent, onIntentHandled }: CalendarPageProps) {
  const [events, setEvents] = useState<Event[] | null>(null);
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [subjects, setSubjects] = useState<Subject[] | null>(null);
  const [exams, setExams] = useState<Exam[] | null>(null);
  const [blocks, setBlocks] = useState<StudyBlockWithExam[] | null>(null);
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [location, setLocation] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        // Sync every study plan first so past blocks are already labelled
        // `missed` when the agenda/grid reads them.
        await window.nexus.syncAllPlans(profileId);
        const today = localTodayKey();
        const [nextEvents, nextTasks, nextSubjects, nextExams, nextBlocks] = await Promise.all([
          window.nexus.listEvents(profileId),
          window.nexus.listTasks(profileId),
          window.nexus.listSubjects(profileId),
          window.nexus.listExams(profileId),
          window.nexus.listBlocksInRange(
            profileId,
            shiftDayKey(today, -BLOCKS_PAST_DAYS),
            shiftDayKey(today, BLOCKS_FUTURE_DAYS),
          ),
        ]);
        if (!active) return;
        setEvents(nextEvents);
        setTasks(nextTasks);
        setSubjects(nextSubjects);
        setExams(nextExams);
        setBlocks(nextBlocks);
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
    setTitle("");
    setAllDay(false);
    setDate("");
    setTime("");
    setEndTime("");
    setLocation("");
    setFormError(null);
  }

  /** Loads an event into the shared form and switches it to edit mode. */
  function startEdit(event: Event): void {
    setEditingId(event.id);
    setTitle(event.title);
    setAllDay(event.allDay);
    setDate(event.startAt.slice(0, 10));
    setTime(event.allDay ? "" : event.startAt.slice(11, 16));
    setEndTime(!event.allDay && event.endAt ? event.endAt.slice(11, 16) : "");
    setLocation(event.location ?? "");
    setFormError(null);
    titleRef.current?.focus();
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
      if (view === "dokumenta") {
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
    if (view === "dokumenta") {
      selectView("agenda");
      return; // wait for the form to mount before loading the event into it
    }
    setAnchorKey(event.startAt.slice(0, 10));
    startEdit(event);
    onIntentHandled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent, events, view, onIntentHandled]);

  /** Click on a month-grid day cell's empty area: prefill the form's date and focus the title. */
  function selectDay(dayKey: string): void {
    setEditingId(null);
    setTitle("");
    setAllDay(false);
    setDate(dayKey);
    setTime("");
    setEndTime("");
    setLocation("");
    setFormError(null);
    titleRef.current?.focus();
  }

  /** Click on empty hour-grid space (week/day view): prefill date, a default hour-long span, and focus the title. */
  function selectSlot(dayKey: string, minutes: number): void {
    setEditingId(null);
    setTitle("");
    setAllDay(false);
    setDate(dayKey);
    setTime(formatClock(minutes));
    setEndTime(formatClock(Math.min(minutes + 60, 23 * 60 + 59)));
    setLocation("");
    setFormError(null);
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
    const startAt = allDay ? date : `${date}T${effectiveTime}`;
    const trimmedLocation = location.trim();
    const trimmedEndTime = endTime.trim();

    // The store throws on an end that doesn't strictly follow the start —
    // caught after the fact isn't good enough, so a bad pair never leaves
    // this form at all.
    if (!allDay && trimmedEndTime.length > 0 && trimmedEndTime <= effectiveTime) {
      setFormError(strings.calendar.endBeforeStart);
      return;
    }
    // Null clears a stored end time exactly like `location` already clears —
    // but only for a timed event: all-day has no end-time field to begin
    // with, so `endAt` is left out of the payload entirely rather than
    // nulling whatever end DATE a multi-day all-day event might carry.
    const timedEndAt = trimmedEndTime.length > 0 ? `${date}T${trimmedEndTime}` : null;

    try {
      if (editingId != null) {
        const changes: EventFieldChanges = {
          title: trimmedTitle,
          startAt,
          allDay,
          location: trimmedLocation.length > 0 ? trimmedLocation : null,
        };
        if (!allDay) changes.endAt = timedEndAt;
        const updated = await window.nexus.updateEvent(profileId, editingId, changes);
        setEvents((prev) => prev && prev.map((e) => (e.id === updated.id ? updated : e)));
        resetForm();
      } else {
        const fields: NewEventFields = { title: trimmedTitle, startAt, allDay };
        // Only send location/endAt when present (exactOptionalPropertyTypes).
        if (trimmedLocation.length > 0) fields.location = trimmedLocation;
        if (!allDay && timedEndAt != null) fields.endAt = timedEndAt;
        const created = await window.nexus.createEvent(profileId, fields);
        setEvents((prev) => (prev ? [...prev, created] : [created]));
        resetForm();
        titleRef.current?.focus();
      }
    } catch (error) {
      console.error("Nexus: failed to save event:", error);
    }
  }

  async function remove(event: Event): Promise<void> {
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
      const delta = daysBetween(item.startKey, dayKey);
      if (delta === 0) return;
      const event = item.event;
      const newStartDate = shiftDayKey(event.startAt.slice(0, 10), delta);
      const changes: EventFieldChanges = {
        startAt: event.allDay ? newStartDate : `${newStartDate}T${event.startAt.slice(11, 16)}`,
      };
      if (event.endAt) {
        const newEndDate = shiftDayKey(event.endAt.slice(0, 10), delta);
        changes.endAt = event.allDay ? newEndDate : `${newEndDate}T${event.endAt.slice(11, 16)}`;
      }
      try {
        const updated = await window.nexus.updateEvent(profileId, event.id, changes);
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

  // All five resolve together (one Promise.all), so a single null means loading.
  const dataLoading =
    events === null || tasks === null || subjects === null || exams === null || blocks === null;
  const calendarItems = dataLoading
    ? []
    : buildCalendarItems({ events, tasks, exams, blocks, subjects }, sources);
  const todayKey = localTodayKey();

  // Every grid view derives from the one anchor day; cheap to compute both
  // unconditionally rather than branch on `view` twice below.
  const monthKey = monthKeyOf(anchorKey);
  const weekKeys = weekDayKeys(anchorKey, WEEK_START);
  const isGridView = view === "mesec" || view === "nedelja" || view === "dan";
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
      <div className="cal__views" role="group" aria-label={strings.calendar.viewLabel}>
        {(["mesec", "nedelja", "dan", "agenda", "dokumenta"] as const).map((option) => (
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
                    : strings.calendar.viewDokumenta}
          </Button>
        ))}
      </div>

      {view !== "dokumenta" && (
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
              onChange={(event) => setDate(event.target.value)}
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
                                onClick={() => startEdit(item.event)}
                              >
                                ✎
                              </Button>
                              <Button
                                size="sm"
                                className="cal__delete"
                                aria-label={strings.calendar.deleteLabel}
                                onClick={() => void remove(item.event)}
                              >
                                ×
                              </Button>
                            </span>
                          }
                        >
                          <span className="cal__event">
                            <span className="cal__event-title">{item.event.title}</span>
                            {item.event.location ? (
                              <Chip variant="data">{item.event.location}</Chip>
                            ) : null}
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
