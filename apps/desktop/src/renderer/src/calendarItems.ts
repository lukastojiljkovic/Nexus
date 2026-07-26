import type { Event, Exam, StudyBlockWithExam, Subject, Task } from "../../shared/ipc.js";

/**
 * Shared calendar source merge (ADR-020). Every calendar surface — the month
 * grid, the agenda — reads the same `CalendarItem[]` stream, built here once
 * from the four raw row sources. `@nexus/core`'s calendar-grid math throws a
 * `TypeError` on a malformed day key, so this layer is the single place that
 * validates and normalizes a row's day key(s) before anything downstream ever
 * sees it.
 */

export type CalendarSource = "events" | "tasks" | "exams" | "blocks";
export const CALENDAR_SOURCES: readonly CalendarSource[] = ["events", "tasks", "exams", "blocks"];

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

export type CalendarItem = CalendarItemBase &
  (
    | { kind: "event"; event: Event }
    | { kind: "task"; task: Task }
    | { kind: "exam"; exam: Exam; subject: Subject }
    | { kind: "block"; block: StudyBlockWithExam; exam: Exam; subject: Subject }
  );

export interface CalendarSourceRows {
  readonly events: readonly Event[];
  readonly tasks: readonly Task[];
  readonly exams: readonly Exam[];
  readonly blocks: readonly StudyBlockWithExam[];
  readonly subjects: readonly Subject[];
}

function isDayKey(key: string): boolean {
  return DAY_KEY_RE.test(key);
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

function buildEventItems(events: readonly Event[]): CalendarItem[] {
  const items: CalendarItem[] = [];
  for (const event of events) {
    const startKey = event.startAt.slice(0, 10);
    if (!isDayKey(startKey)) continue;

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

    items.push({
      id: `event-${event.id}`,
      source: "events",
      kind: "event",
      event,
      startKey,
      endKey,
      startMinutes,
      endMinutes,
      sortKey: event.allDay ? startKey : event.startAt,
    });
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

/** Merges the enabled sources into one calendar stream; only requested sources are built at all. */
export function buildCalendarItems(
  rows: CalendarSourceRows,
  enabled: ReadonlySet<CalendarSource>,
): CalendarItem[] {
  const subjectsById = new Map(rows.subjects.map((subject) => [subject.id, subject] as const));
  const examsById = new Map(rows.exams.map((exam) => [exam.id, exam] as const));

  const items: CalendarItem[] = [];
  if (enabled.has("events")) items.push(...buildEventItems(rows.events));
  if (enabled.has("tasks")) items.push(...buildTaskItems(rows.tasks));
  if (enabled.has("exams")) items.push(...buildExamItems(rows.exams, subjectsById));
  if (enabled.has("blocks")) items.push(...buildBlockItems(rows.blocks, examsById, subjectsById));
  return items;
}

const SOURCES_KEY_PREFIX = "nexus.calendar.sources.";

/**
 * Nothing stored, or nothing recognizable stored ⇒ all four enabled, the honest
 * default. An explicitly empty string is NOT that case: it is the user having
 * switched every source off, and reading it back as "all on" would quietly undo
 * a choice they made.
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
