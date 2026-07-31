import { useCallback, useEffect, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import { computeStreak, matchesSmartList } from "@nexus/core";
import { Button, Chip, ListRow } from "@nexus/ui";
import type { DocumentStatus, Event, Exam, Subject } from "../../shared/ipc.js";
import { buildCalendarItems } from "./calendarItems.js";
import type { CalendarItem, CalendarSource } from "./calendarItems.js";
import {
  daysUntilExam,
  examCountdownLabel,
  examCountdownVariant,
  formatExamDate,
  localTodayKey,
  shiftDayKey,
} from "./examDates.js";
import { focusSessionMinutes, formatDurationMinutes } from "./focusFormat.js";
import { dayUnit, strings } from "./strings.js";

/**
 * The dashboard's widget bodies (DASH-002 / ADR-045 slice b) — one component per
 * registered widget, plus the map `DashboardPage` looks a placement up in.
 *
 * Until this slice these five were `<Card>`s inside the page, fed by one
 * eight-call `Promise.all` behind a page-wide loading gate. They are components
 * with their OWN fetches now, for the reason ADR-045 section 4 gives: a
 * dashboard is a set of independent facts, so one slow or broken read must cost
 * exactly the card that made it — not the whole page. The visible price is that
 * two widgets both read the task list; that is a boundary being real, and the
 * store is a local SQLite call away.
 *
 * Everything here is READ-ONLY: rows deep-link into their module (DASH-005) and
 * nothing writes. The page owns the layout, the frame and the edit mode.
 */

// --- Formatting helpers (renderer-local, mirror the module pages) -----------
//
// DASH is a pure aggregation surface: it reads the same tasks/events/documents
// the modules own and reformats them into "šta mi je danas bitno?" cards. The
// date rules match the pages exactly — wall-clock ("today") is local, while a
// bare calendar date (a due date, an all-day start) is treated as UTC so it does
// not shift a day back when formatted in a negative-offset timezone.

/** Row time label — "Ceo dan" for all-day, else HH:MM (mirrors CalendarPage). */
function formatEventTime(event: Event): string {
  if (event.allDay) return strings.calendar.allDay;
  const date = new Date(event.startAt);
  return Number.isNaN(date.getTime())
    ? event.startAt
    : new Intl.DateTimeFormat("sr-Latn", { hour: "2-digit", minute: "2-digit" }).format(date);
}

/** Compact due-date chip label — "15. jul"; UTC-parsed for the bare calendar date. */
function formatDueDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : new Intl.DateTimeFormat("sr-Latn", { day: "2-digit", month: "short", timeZone: "UTC" }).format(
        date,
      );
}

// Status → Chip variant, reusing DocumentsPanel's mapping: on time reads as data,
// the reminder window as accent, an expired document as danger.
const STATUS_VARIANT: Record<DocumentStatus, "data" | "accent" | "danger"> = {
  ok: "data",
  uskoro: "accent",
  istekao: "danger",
};

/**
 * "Time to expiry" hint from the store's derived daysUntilExpiry, reusing the
 * strings.documents.days phrasing so DASH and CAL never drift. The dan/dana
 * agreement comes from `dayUnit` (21 → "dan", 22 → "dana").
 */
function daysUntilLabel(days: number): string {
  const d = strings.documents.days;
  if (days > 1) return `${d.future} ${days} ${dayUnit(days, d.unitOne, d.unitMany)}`;
  if (days === 1) return d.tomorrow;
  if (days === 0) return d.today;
  const ago = Math.abs(days);
  return `${d.pastPrefix} ${ago} ${dayUnit(ago, d.unitOne, d.unitMany)}`;
}

/** A read-only widget row that deep-links into its module on click/Enter. */
function DashRow({
  onClick,
  leading,
  trailing,
  children,
}: {
  onClick: () => void;
  leading?: ReactNode;
  trailing?: ReactNode;
  children: ReactNode;
}) {
  return (
    <button type="button" className="dash__row" onClick={onClick}>
      <ListRow leading={leading} trailing={trailing}>
        {children}
      </ListRow>
    </button>
  );
}

// --- Per-widget fetch boundaries (ADR-045 section 4) ------------------------

/** Where one widget's own read has got to. */
type WidgetState<T> = { status: "loading" } | { status: "ready"; data: T } | { status: "failed" };

/**
 * Runs ONE widget's reads and keeps their outcome — the whole of a widget's
 * data boundary, so the page above holds no widget data at all.
 *
 * `load` must be a `useCallback` over the profile and whichever module flags it
 * reads, which is what makes the dependency list here an honest array literal:
 * a re-fetch happens when the query really changed, or when „Pokušaj ponovo"
 * bumps `attempt`.
 */
function useWidgetData<T>(load: () => Promise<T>): {
  state: WidgetState<T>;
  retry: () => void;
} {
  const [state, setState] = useState<WidgetState<T>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    void (async () => {
      try {
        const data = await load();
        if (active) setState({ status: "ready", data });
      } catch (error) {
        if (active) setState({ status: "failed" });
        console.error("Nexus: a dashboard widget failed to load:", error);
      }
    })();
    return () => {
      active = false;
    };
  }, [load, attempt]);

  return { state, retry: () => setAttempt((value) => value + 1) };
}

/** The quiet placeholder a widget shows while its own read is in flight. */
function WidgetSkeleton() {
  return (
    <div className="dash__skeleton" role="status" aria-label={strings.app.loading}>
      <span className="dash__skeleton-line" />
      <span className="dash__skeleton-line" />
      <span className="dash__skeleton-line" />
    </div>
  );
}

/** One widget's isolated failure: this card could not read, and the way to ask again. */
function WidgetFailure({ onRetry }: { onRetry: () => void }) {
  const s = strings.dashboard.widget;
  return (
    <div className="dash__failure" role="alert">
      <p className="dash__empty">{s.error}</p>
      <Button size="sm" onClick={onRetry}>
        {s.retry}
      </Button>
    </div>
  );
}

/** Skeleton, isolated failure, or the body — the three states every widget has. */
function WidgetData<T>({
  state,
  retry,
  children,
}: {
  state: WidgetState<T>;
  retry: () => void;
  children: (data: T) => ReactNode;
}) {
  if (state.status === "loading") return <WidgetSkeleton />;
  if (state.status === "failed") return <WidgetFailure onRetry={retry} />;
  return <>{children(state.data)}</>;
}

// --- The widgets ------------------------------------------------------------

/** Everything a widget body is given: whose data, which modules are on, and how to deep-link out. */
export interface DashboardWidgetBodyProps {
  profileId: string;
  /** SET-007 flags, for the one widget that reads across two modules. */
  enabledModules: ReadonlySet<string>;
  onOpenModule: (id: string) => void;
}

/**
 * "Danas" reads events and birthdays through the calendar's own merge, for one
 * reason: both are stored as a single row that only the merge knows how to
 * expand into the occurrence falling today — a recurring event from its rule
 * (ADR-024), a person from their yearless (month, day) (ADR-026). Those two are
 * the only sources asked for; tasks reach this card by their own route below.
 */
const TODAY_SOURCES: ReadonlySet<CalendarSource> = new Set<CalendarSource>([
  "events",
  "birthdays",
]);

/**
 * „Danas" — today's events (chronological), then whose birthday it is, then
 * tasks due today. The one widget that reads across two modules, so it is also
 * the one whose fetch is per-module conditional: with CAL off it is a task
 * card, with TASK off a calendar one (see `DASHBOARD_WIDGETS`' visibility).
 */
function TodayWidget({ profileId, enabledModules, onOpenModule }: DashboardWidgetBodyProps) {
  const calendarEnabled = enabledModules.has("calendar");
  const tasksEnabled = enabledModules.has("tasks");
  const load = useCallback(async () => {
    const [events, people, tasks] = await Promise.all([
      calendarEnabled ? window.nexus.listEvents(profileId) : [],
      calendarEnabled ? window.nexus.listPeople(profileId) : [],
      tasksEnabled ? window.nexus.listTasks(profileId) : [],
    ]);
    return { events, people, tasks };
  }, [profileId, calendarEnabled, tasksEnabled]);
  const { state, retry } = useWidgetData(load);
  const s = strings.dashboard.today;
  const todayKey = localTodayKey();

  return (
    <WidgetData state={state} retry={retry}>
      {({ events, people, tasks }) => {
        // An all-day event's bare "YYYY-MM-DD" sorts before any timed start,
        // matching the store. Recurring masters are expanded over today alone,
        // and each item's `event` is that occurrence's own copy, so the time
        // shown is the time it happens at.
        const items = buildCalendarItems(
          { events, tasks: [], exams: [], blocks: [], subjects: [], people },
          TODAY_SOURCES,
          { from: todayKey, to: todayKey },
        )
          .filter((item) => item.startKey === todayKey)
          .sort((a, b) => a.sortKey.localeCompare(b.sortKey) || a.id.localeCompare(b.id));
        // Only events and birthdays were asked for; the narrowings are what say so in the types.
        const todayEvents = items.filter(
          (item): item is CalendarItem & { kind: "event" } => item.kind === "event",
        );
        const todayBirthdays = items.filter(
          (item): item is CalendarItem & { kind: "birthday" } => item.kind === "birthday",
        );
        // The very predicate TASK's „Danas“ view runs (ADR-049), so the card and
        // that view cannot drift on what "today" means — including the rule that
        // a task starting later is not yet today's.
        //
        // `includeBlocked` is deliberately true: this widget reads the task list
        // alone and never the dependency edges, so it has no honest way to tell
        // a blocked task from a free one, and stating a rule it cannot apply
        // would be worse than showing every task due today.
        const todayTasks = tasks.filter((task) =>
          matchesSmartList(task, "danas", {
            today: todayKey,
            isBlocked: () => false,
            includeBlocked: true,
          }),
        );
        if (todayEvents.length + todayBirthdays.length + todayTasks.length === 0) {
          return <p className="dash__empty">{s.empty}</p>;
        }
        return (
          <div className="dash__list">
            {todayEvents.map((item) => (
              <DashRow
                key={item.id}
                onClick={() => onOpenModule("calendar")}
                leading={<span className="dash__time">{formatEventTime(item.event)}</span>}
              >
                <span className="dash__row-title">{item.event.title}</span>
              </DashRow>
            ))}
            {todayBirthdays.map((item) => (
              <DashRow
                key={item.id}
                onClick={() => onOpenModule("calendar")}
                leading={
                  <span className="dash__time dash__time--tag">
                    {s.personTag[item.person.kind]}
                  </span>
                }
                trailing={
                  item.age !== null ? (
                    <Chip variant="data">
                      {item.age} {strings.calendar.people.yearsUnit}
                    </Chip>
                  ) : undefined
                }
              >
                <span className="dash__row-title">{item.person.name}</span>
              </DashRow>
            ))}
            {todayTasks.map((task) => (
              <DashRow
                key={`task-${task.id}`}
                onClick={() => onOpenModule("tasks")}
                leading={<span className="dash__time dash__time--tag">{s.taskTag}</span>}
              >
                <span className="dash__row-title">{task.title}</span>
              </DashRow>
            ))}
          </div>
        );
      }}
    </WidgetData>
  );
}

/** „Predstojeći zadaci" — the next 5 active tasks by due date (nulls last), then age. */
function UpcomingTasksWidget({ profileId, onOpenModule }: DashboardWidgetBodyProps) {
  const load = useCallback(() => window.nexus.listTasks(profileId), [profileId]);
  const { state, retry } = useWidgetData(load);
  const s = strings.dashboard.upcoming;

  return (
    <WidgetData state={state} retry={retry}>
      {(tasks) => {
        const upcoming = tasks
          .filter((task) => !task.done)
          .sort((a, b) => {
            if (a.dueDate == null && b.dueDate == null)
              return a.createdAt.localeCompare(b.createdAt);
            if (a.dueDate == null) return 1;
            if (b.dueDate == null) return -1;
            return a.dueDate.localeCompare(b.dueDate) || a.createdAt.localeCompare(b.createdAt);
          })
          .slice(0, 5);
        if (upcoming.length === 0) return <p className="dash__empty">{s.empty}</p>;
        return (
          <div className="dash__list">
            {upcoming.map((task) => (
              <DashRow
                key={task.id}
                onClick={() => onOpenModule("tasks")}
                trailing={
                  task.dueDate ? <Chip variant="data">{formatDueDate(task.dueDate)}</Chip> : undefined
                }
              >
                <span className="dash__row-title">{task.title}</span>
              </DashRow>
            ))}
          </div>
        );
      }}
    </WidgetData>
  );
}

/** „Dokumenta koja ističu" — anything past the reminder threshold, soonest first. */
function ExpiringDocumentsWidget({ profileId, onOpenModule }: DashboardWidgetBodyProps) {
  const load = useCallback(() => window.nexus.listDocuments(profileId), [profileId]);
  const { state, retry } = useWidgetData(load);
  const s = strings.dashboard.expiring;

  return (
    <WidgetData state={state} retry={retry}>
      {(documents) => {
        const expiring = documents
          .filter((doc) => doc.status !== "ok")
          .sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry || a.id.localeCompare(b.id));
        if (expiring.length === 0) return <p className="dash__empty">{s.empty}</p>;
        return (
          <div className="dash__list">
            {expiring.map((doc) => (
              <DashRow
                key={doc.id}
                onClick={() => onOpenModule("calendar")}
                leading={
                  <Chip variant={STATUS_VARIANT[doc.status]}>
                    {strings.documents.status[doc.status]}
                  </Chip>
                }
                trailing={<span className="dash__days">{daysUntilLabel(doc.daysUntilExpiry)}</span>}
              >
                <span className="dash__doc">
                  <span className="dash__doc-type">{strings.documents.type[doc.docType]}</span>
                  <span className="dash__doc-label">{doc.label}</span>
                </span>
              </DashRow>
            ))}
          </div>
        );
      }}
    </WidgetData>
  );
}

/**
 * „Ispiti" — the next upcoming exams (today or later), soonest first, capped at
 * 5. An orphaned exam (its subject was soft-deleted) is skipped rather than
 * shown without a name.
 */
function ExamsWidget({ profileId, onOpenModule }: DashboardWidgetBodyProps) {
  const load = useCallback(async () => {
    const [subjects, exams] = await Promise.all([
      window.nexus.listSubjects(profileId),
      window.nexus.listExams(profileId),
    ]);
    return { subjects, exams };
  }, [profileId]);
  const { state, retry } = useWidgetData(load);

  return (
    <WidgetData state={state} retry={retry}>
      {({ subjects, exams }) => {
        const subjectsById = new Map(subjects.map((subject) => [subject.id, subject] as const));
        const upcoming = exams
          .map((exam) => ({
            exam,
            subject: subjectsById.get(exam.subjectId),
            days: daysUntilExam(exam.examDate),
          }))
          .filter(
            (entry): entry is { exam: Exam; subject: Subject; days: number } =>
              entry.subject != null && entry.days >= 0,
          )
          .sort((a, b) => a.days - b.days || a.exam.id.localeCompare(b.exam.id))
          .slice(0, 5);
        if (upcoming.length === 0) {
          return <p className="dash__empty">{strings.study.dashboardEmpty}</p>;
        }
        return (
          <div className="dash__list">
            {upcoming.map(({ exam, subject, days }) => (
              <DashRow
                key={exam.id}
                onClick={() => onOpenModule("study")}
                trailing={
                  <Chip variant={examCountdownVariant(days)}>{examCountdownLabel(days)}</Chip>
                }
              >
                <span className="dash__exam">
                  <span className="dash__exam-subject">{subject.name}</span>
                  <span className="dash__exam-meta">
                    <span>{strings.study.examType[exam.examType]}</span>
                    <span>{formatExamDate(exam.examDate)}</span>
                  </span>
                </span>
              </DashRow>
            ))}
          </div>
        );
      }}
    </WidgetData>
  );
}

/**
 * „Učenje" — the study streak (the same 365-day-window rule as StudyPage) and
 * today's completed focus minutes; either can be zero independently, and the
 * card shows the gentle zero copy only when both are. A running timer
 * deliberately does not count: only `listFocusRange`'s persisted sessions do.
 */
function StudyWidget({ profileId, onOpenModule }: DashboardWidgetBodyProps) {
  const load = useCallback(async () => {
    const today = localTodayKey();
    const [stats, sessions] = await Promise.all([
      window.nexus.studyStats(profileId, shiftDayKey(today, -365), today),
      window.nexus.listFocusRange(profileId, today, today),
    ]);
    return { stats, sessions, today };
  }, [profileId]);
  const { state, retry } = useWidgetData(load);

  return (
    <WidgetData state={state} retry={retry}>
      {({ stats, sessions, today }) => {
        const streak = computeStreak(stats.activityDays, today);
        const focusMinutes = sessions.reduce(
          (total, session) => total + focusSessionMinutes(session),
          0,
        );
        const hasStreak = streak.current > 0;
        if (!hasStreak && focusMinutes === 0) {
          return <p className="dash__empty">{strings.study.streakZero}</p>;
        }
        return (
          <div className="dash__list">
            <DashRow onClick={() => onOpenModule("study")}>
              <span className="dash__study">
                {hasStreak && (
                  <span className="dash__study-line">
                    {strings.study.streakLabel}: {streak.current}{" "}
                    {dayUnit(streak.current, strings.study.streakUnitOne, strings.study.streakUnitMany)}
                  </span>
                )}
                {focusMinutes > 0 && (
                  <span className="dash__study-line">
                    {strings.study.dashboardFocusTodayLabel}: {formatDurationMinutes(focusMinutes)}
                  </span>
                )}
              </span>
            </DashRow>
          </div>
        );
      }}
    </WidgetData>
  );
}

// --- The registry-driven map (ADR-045 section 3) ----------------------------

/** How the page draws one placement: the body, and whether it draws at all. */
export interface DashboardWidgetRenderer {
  Body: ComponentType<DashboardWidgetBodyProps>;
  /**
   * Whether this widget draws, given the SET-007 flags. Normally "is my owning
   * module on?" — „Danas" is the documented exception (PRD 02 DASH), because it
   * merges two modules' data and stays useful with either one of them off.
   */
  visible: (enabled: ReadonlySet<string>) => boolean;
}

/**
 * Qualified widget id → how to draw it. The catalogue is the module registry's
 * (`widgetsOf`/`findWidget`); this is the renderer half of the same pairing, and
 * `modules.test.ts` pins that the two agree on the default layout.
 *
 * A placement this map does not know draws NOTHING and is kept in storage
 * (DASH-002): a layout must survive a module being dropped from the build and
 * come back when it returns.
 */
export const DASHBOARD_WIDGETS: Record<string, DashboardWidgetRenderer> = {
  "calendar:danas": {
    Body: TodayWidget,
    visible: (enabled) => enabled.has("calendar") || enabled.has("tasks"),
  },
  "tasks:predstojece": { Body: UpcomingTasksWidget, visible: (enabled) => enabled.has("tasks") },
  "calendar:isticanja": {
    Body: ExpiringDocumentsWidget,
    visible: (enabled) => enabled.has("calendar"),
  },
  "study:ispiti": { Body: ExamsWidget, visible: (enabled) => enabled.has("study") },
  "study:ucenje": { Body: StudyWidget, visible: (enabled) => enabled.has("study") },
};
