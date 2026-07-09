import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { Button, Checkbox, Chip, EmptyState, ListRow, TextField } from "@nexus/ui";
import type {
  Event,
  EventFieldChanges,
  Exam,
  NewEventFields,
  StudyBlockWithExam,
  Subject,
} from "../../shared/ipc.js";
import { DocumentsPanel } from "./DocumentsPanel.js";
import {
  daysUntilExam,
  examCountdownLabel,
  examCountdownVariant,
  localTodayKey,
  shiftDayKey,
} from "./examDates.js";
import { strings } from "./strings.js";

// --- Per-profile view memory (interim, mirrors TasksPage) -------------------
//
// Agenda vs Dokumenta is a lightweight UI preference, persisted per profile in
// localStorage exactly like the tasks list/kanban toggle. The month grid is a
// later slice; this toggle only picks between the agenda and the documents panel.
type CalendarView = "agenda" | "dokumenta";
const VIEW_KEY_PREFIX = "nexus.calendar.view.";

function readStoredView(profileId: string): CalendarView {
  return localStorage.getItem(VIEW_KEY_PREFIX + profileId) === "dokumenta"
    ? "dokumenta"
    : "agenda";
}
function persistView(profileId: string, view: CalendarView): void {
  localStorage.setItem(VIEW_KEY_PREFIX + profileId, view);
}

// --- Agenda grouping (page-level, not the views engine) ---------------------
//
// The store returns events ordered by startAt then id, but the create path
// appends optimistically, so the display order is re-derived here rather than
// trusted from insertion order. The rule matches the store's exactly — an
// all-day event's bare "YYYY-MM-DD" sorts before any timed start on that day.
// Exams (STUDY-002) and study blocks (STUDY-003) are merged in as read-only
// rows: their bare dates sort the same way a bare all-day date does, ahead of
// any timed event; within one bare date, kind rank keeps the order
// deterministic (events, then exams, then blocks — blocks sit next to exams).

// Study blocks are fetched over a bounded window around today (the agenda
// itself has no explicit bounds): a month back covers recently missed blocks,
// a year ahead outruns any plannable exam distance.
const BLOCKS_PAST_DAYS = 31;
const BLOCKS_FUTURE_DAYS = 365;

/** An agenda row: a real event, a read-only exam, or a read-only study block. */
type AgendaEntry =
  | { kind: "event"; sortKey: string; dayKey: string; event: Event }
  | { kind: "exam"; sortKey: string; dayKey: string; exam: Exam; subject: Subject }
  | {
      kind: "block";
      sortKey: string;
      dayKey: string;
      block: StudyBlockWithExam;
      exam: Exam;
      subject: Subject;
    };

/** Within one sortKey (a bare day), events come first, then exams, then blocks. */
const KIND_RANK: Record<AgendaEntry["kind"], number> = { event: 0, exam: 1, block: 2 };

function entryId(entry: AgendaEntry): string {
  if (entry.kind === "event") return entry.event.id;
  return entry.kind === "exam" ? entry.exam.id : entry.block.id;
}

/** Merges events, exams and study blocks into one agenda stream; an orphaned
 * exam/block (its subject or exam was soft-deleted) is skipped rather than
 * shown without a name/colour. */
function buildAgendaEntries(
  events: Event[],
  exams: Exam[],
  blocks: StudyBlockWithExam[],
  subjects: Subject[],
): AgendaEntry[] {
  const subjectsById = new Map(subjects.map((subject) => [subject.id, subject] as const));
  const examsById = new Map(exams.map((exam) => [exam.id, exam] as const));
  const eventEntries: AgendaEntry[] = events.map((event) => ({
    kind: "event",
    sortKey: event.startAt,
    dayKey: event.startAt.slice(0, 10),
    event,
  }));
  const examEntries: AgendaEntry[] = [];
  for (const exam of exams) {
    const subject = subjectsById.get(exam.subjectId);
    if (!subject) continue;
    const dayKey = exam.examDate.slice(0, 10);
    examEntries.push({ kind: "exam", sortKey: dayKey, dayKey, exam, subject });
  }
  const blockEntries: AgendaEntry[] = [];
  for (const block of blocks) {
    const exam = examsById.get(block.examId);
    const subject = exam ? subjectsById.get(exam.subjectId) : undefined;
    if (!exam || !subject) continue;
    blockEntries.push({
      kind: "block",
      sortKey: block.blockDate,
      dayKey: block.blockDate,
      block,
      exam,
      subject,
    });
  }
  return [...eventEntries, ...examEntries, ...blockEntries];
}

/** Agenda entries bucketed by calendar day, days and rows both ascending. */
function groupAgenda(entries: AgendaEntry[]): [string, AgendaEntry[]][] {
  const ordered = [...entries].sort((a, b) => {
    const cmp = a.sortKey.localeCompare(b.sortKey);
    if (cmp !== 0) return cmp;
    const rank = KIND_RANK[a.kind] - KIND_RANK[b.kind];
    if (rank !== 0) return rank;
    return entryId(a).localeCompare(entryId(b));
  });
  const groups = new Map<string, AgendaEntry[]>();
  for (const entry of ordered) {
    const bucket = groups.get(entry.dayKey);
    if (bucket) bucket.push(entry);
    else groups.set(entry.dayKey, [entry]);
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

export interface CalendarPageProps {
  profileId: string;
}

/**
 * The CAL module page (v0 basics): a single form that both adds and edits
 * events, and a day-grouped chronological agenda with per-row edit and
 * delete-with-undo. Every write goes through the events:* IPC allowlist, so the
 * store stays the single source of truth (e.g. it validates startAt and derives
 * updatedAt). endAt/description/category are deferred — the form stays minimal.
 * Upcoming exams (STUDY-002) and study blocks (STUDY-003) are merged into the
 * same agenda as read-only rows — they are not editable here; exam editing and
 * block check-off live in StudyPage.
 */
export function CalendarPage({ profileId }: CalendarPageProps) {
  const [events, setEvents] = useState<Event[] | null>(null);
  const [subjects, setSubjects] = useState<Subject[] | null>(null);
  const [exams, setExams] = useState<Exam[] | null>(null);
  const [blocks, setBlocks] = useState<StudyBlockWithExam[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<CalendarView>(() => readStoredView(profileId));
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
        // `missed` when the agenda reads them.
        await window.nexus.syncAllPlans(profileId);
        const today = localTodayKey();
        const [nextEvents, nextSubjects, nextExams, nextBlocks] = await Promise.all([
          window.nexus.listEvents(profileId),
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

  // All four resolve together (one Promise.all), so a single null means loading.
  const agendaLoading = events === null || subjects === null || exams === null || blocks === null;
  const agendaEntries = agendaLoading
    ? []
    : buildAgendaEntries(events, exams, blocks, subjects);

  return (
    <div className="cal">
      <div className="cal__views" role="group" aria-label={strings.calendar.viewLabel}>
        {(["agenda", "dokumenta"] as const).map((option) => (
          <Button
            key={option}
            size="sm"
            className={view === option ? "cal__view cal__view--active" : "cal__view"}
            aria-pressed={view === option}
            onClick={() => selectView(option)}
          >
            {option === "agenda" ? strings.calendar.viewAgenda : strings.calendar.viewDokumenta}
          </Button>
        ))}
      </div>

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
          ) : agendaLoading ? (
            <p className="app__muted">{strings.app.loading}</p>
          ) : agendaEntries.length === 0 ? (
            <EmptyState
              title={strings.calendar.emptyTitle}
              description={strings.calendar.emptyDescription}
            />
          ) : (
            <div className="cal__agenda">
              {groupAgenda(agendaEntries).map(([key, dayEntries]) => (
                <section key={key} className="cal__day">
                  <h2 className="cal__day-header">{formatDay(key)}</h2>
                  {dayEntries.map((entry) => {
                    if (entry.kind === "event") {
                      return (
                        <ListRow
                          key={`event-${entry.event.id}`}
                          leading={<span className="cal__time">{formatTime(entry.event)}</span>}
                          trailing={
                            <span className="cal__row-actions">
                              <Button
                                size="sm"
                                className="cal__edit"
                                aria-label={strings.calendar.editLabel}
                                onClick={() => startEdit(entry.event)}
                              >
                                ✎
                              </Button>
                              <Button
                                size="sm"
                                className="cal__delete"
                                aria-label={strings.calendar.deleteLabel}
                                onClick={() => void remove(entry.event)}
                              >
                                ×
                              </Button>
                            </span>
                          }
                        >
                          <span className="cal__event">
                            <span className="cal__event-title">{entry.event.title}</span>
                            {entry.event.location ? (
                              <Chip variant="data">{entry.event.location}</Chip>
                            ) : null}
                          </span>
                        </ListRow>
                      );
                    }
                    if (entry.kind === "exam") {
                      const days = daysUntilExam(entry.exam.examDate);
                      return (
                        <ListRow
                          key={`exam-${entry.exam.id}`}
                          muted={days < 0}
                          leading={
                            <span className="cal__time cal__exam-time">
                              <span
                                className={`study__dot study__dot--${entry.subject.color}`}
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
                              {entry.subject.name} — {strings.study.examType[entry.exam.examType]}
                            </span>
                            {entry.exam.scope ? <Chip variant="data">{entry.exam.scope}</Chip> : null}
                          </span>
                        </ListRow>
                      );
                    }
                    // Study-block row (STUDY-003): read-only — check-off lives on StudyPage.
                    const status = entry.block.status;
                    return (
                      <ListRow
                        key={`block-${entry.block.id}`}
                        muted={status === "missed"}
                        leading={
                          <span className="cal__time cal__exam-time">
                            <span
                              className={`study__dot study__dot--${entry.subject.color}`}
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
                            {entry.subject.name} — {strings.study.examType[entry.exam.examType]}
                          </span>
                          <Chip>
                            {entry.block.minutes} {strings.study.minutesUnit}
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
