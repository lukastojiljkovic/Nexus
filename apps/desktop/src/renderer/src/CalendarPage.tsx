import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, KeyboardEvent } from "react";
import { Button, Checkbox, Chip, EmptyState, ListRow, TextField } from "@nexus/ui";
import { monthKeyOf, shiftDayKey, shiftMonthKey } from "@nexus/core";
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
import {
  buildCalendarItems,
  CALENDAR_SOURCES,
  persistSources,
  readStoredSources,
} from "./calendarItems.js";
import type { CalendarItem, CalendarSource } from "./calendarItems.js";
import { DocumentsPanel } from "./DocumentsPanel.js";
import { daysUntilExam, examCountdownLabel, examCountdownVariant, localTodayKey } from "./examDates.js";
import { strings } from "./strings.js";

// --- Per-profile view memory (interim, mirrors TasksPage) -------------------
//
// Mesec / Agenda / Dokumenta is a lightweight UI preference, persisted per
// profile in localStorage exactly like the tasks list/kanban toggle.
type CalendarView = "mesec" | "agenda" | "dokumenta";
const VIEW_KEY_PREFIX = "nexus.calendar.view.";

function readStoredView(profileId: string): CalendarView {
  const raw = localStorage.getItem(VIEW_KEY_PREFIX + profileId);
  return raw === "agenda" || raw === "dokumenta" ? raw : "mesec";
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

export interface CalendarPageProps {
  profileId: string;
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
export function CalendarPage({ profileId }: CalendarPageProps) {
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
  const [monthKey, setMonthKey] = useState<string>(() => monthKeyOf(localTodayKey()));
  const [pendingUndoId, setPendingUndoId] = useState<string | null>(null);

  // One form serves both modes; a non-null editingId means "editing that event".
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [location, setLocation] = useState("");
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
    setLocation("");
  }

  /** Loads an event into the shared form and switches it to edit mode. */
  function startEdit(event: Event): void {
    setEditingId(event.id);
    setTitle(event.title);
    setAllDay(event.allDay);
    setDate(event.startAt.slice(0, 10));
    setTime(event.allDay ? "" : event.startAt.slice(11, 16));
    setLocation(event.location ?? "");
    titleRef.current?.focus();
  }

  /** Click on a month-grid day cell's empty area: prefill the form's date and focus the title. */
  function selectDay(dayKey: string): void {
    setEditingId(null);
    setTitle("");
    setAllDay(false);
    setDate(dayKey);
    setTime("");
    setLocation("");
    titleRef.current?.focus();
  }

  function shiftMonth(delta: number): void {
    setMonthKey((prev) => shiftMonthKey(prev, delta));
  }
  function goToday(): void {
    setMonthKey(monthKeyOf(localTodayKey()));
  }
  function handleMonthKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      shiftMonth(-1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      shiftMonth(1);
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
    const startAt = allDay ? date : `${date}T${time || "09:00"}`;
    const trimmedLocation = location.trim();

    try {
      if (editingId != null) {
        // Empty location clears the stored value; a non-empty one sets it.
        const changes: EventFieldChanges = {
          title: trimmedTitle,
          startAt,
          allDay,
          location: trimmedLocation.length > 0 ? trimmedLocation : null,
        };
        const updated = await window.nexus.updateEvent(profileId, editingId, changes);
        setEvents((prev) => prev && prev.map((e) => (e.id === updated.id ? updated : e)));
        resetForm();
      } else {
        const fields: NewEventFields = { title: trimmedTitle, startAt, allDay };
        // Only send location when present (exactOptionalPropertyTypes).
        if (trimmedLocation.length > 0) fields.location = trimmedLocation;
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

  return (
    <div className="cal">
      <div className="cal__views" role="group" aria-label={strings.calendar.viewLabel}>
        {(["mesec", "agenda", "dokumenta"] as const).map((option) => (
          <Button
            key={option}
            size="sm"
            className={view === option ? "cal__view cal__view--active" : "cal__view"}
            aria-pressed={view === option}
            onClick={() => selectView(option)}
          >
            {option === "mesec"
              ? strings.calendar.viewMesec
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
        <DocumentsPanel profileId={profileId} />
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
              <TextField
                type="time"
                value={time}
                aria-label={strings.calendar.timeLabel}
                onChange={(event) => setTime(event.target.value)}
              />
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
          ) : view === "mesec" ? (
            <div className="cal__month" onKeyDown={handleMonthKeyDown}>
              <div className="cal__month-nav">
                <span className="cal__month-label">{formatMonthLabel(monthKey)}</span>
                <span className="cal__month-nav-actions">
                  <Button
                    size="sm"
                    aria-label={strings.calendar.prevMonth}
                    onClick={() => shiftMonth(-1)}
                  >
                    ‹
                  </Button>
                  <Button size="sm" onClick={goToday}>
                    {strings.calendar.today}
                  </Button>
                  <Button
                    size="sm"
                    aria-label={strings.calendar.nextMonth}
                    onClick={() => shiftMonth(1)}
                  >
                    ›
                  </Button>
                </span>
              </div>
              <CalendarMonth
                monthKey={monthKey}
                todayKey={todayKey}
                items={calendarItems}
                onSelectDay={selectDay}
                onEditEvent={startEdit}
                onMoveItem={(item, dayKey) => void moveItem(item, dayKey)}
              />
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
