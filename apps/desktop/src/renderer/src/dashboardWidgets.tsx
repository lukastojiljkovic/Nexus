import { useCallback, useEffect, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import {
  computeStreak,
  matchesSmartList,
  parseWidgetConfig,
  widgetChoice,
  widgetCount,
  widgetTaskLists,
} from "@nexus/core";
import type { WidgetContract } from "@nexus/core";
import { Button, Chip, ListRow } from "@nexus/ui";
import type { DocumentStatus, Event, Exam, Subject } from "../../shared/ipc.js";
import { buildCalendarItems } from "./calendarItems.js";
import type { CalendarItem, CalendarSource } from "./calendarItems.js";
import {
  capTodayGroups,
  expiringDocumentRows,
  horizonWindowDays,
  upcomingTaskRows,
  urgentTaskRows,
} from "./dashboardWidgetRows.js";
import { formatClockLabel, localMinutesOfDay, readStoredClock } from "./calendarPrefs.js";
import type { ClockPreference } from "./calendarPrefs.js";
import {
  daysUntilExam,
  examCountdownLabel,
  examCountdownVariant,
  formatExamDate,
  localTodayKey,
  shiftDayKey,
} from "./examDates.js";
import { focusSessionMinutes, formatDurationMinutes } from "./focusFormat.js";
import { formatMoney } from "./money.js";
import { formatNotificationWhen } from "./notificationFormat.js";
import { dayUnit, strings } from "./strings.js";

/** The widest window „Predstojeće naplate" ever fetches — its largest horizon option. */
const MAX_RENEWAL_HORIZON_DAYS = 90;
/** The window that card ships on, and what an unreadable stored choice falls back to. */
const DEFAULT_RENEWAL_HORIZON_DAYS = 30;

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
 * The catalogue has grown past those five since (DASH-003): a card added here
 * and to its module's manifest is one the user can place from „Dodaj vidžet“,
 * while the default layout stays exactly the five a new profile opens onto.
 *
 * Everything here is READ-ONLY: rows deep-link into their module (DASH-005) —
 * or, where the module has an intent for it, onto the very entity the row names
 * — and nothing writes. The page owns the layout, the frame and the edit mode.
 */

// --- Formatting helpers (renderer-local, mirror the module pages) -----------
//
// DASH is a pure aggregation surface: it reads the same tasks/events/documents
// the modules own and reformats them into "šta mi je danas bitno?" cards. The
// date rules match the pages exactly — wall-clock ("today") is local, while a
// bare calendar date (a due date, an all-day start) is treated as UTC so it does
// not shift a day back when formatted in a negative-offset timezone.

/** Row time label — "Ceo dan" for all-day, else the device's clock (CAL §5; mirrors CalendarPage). */
function formatEventTime(event: Event, clock: ClockPreference): string {
  if (event.allDay) return strings.calendar.allDay;
  const date = new Date(event.startAt);
  return Number.isNaN(date.getTime())
    ? event.startAt
    : formatClockLabel(localMinutesOfDay(date), clock);
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
  /** This widget's own contract — where its `configFields` declaration lives (DASH-004 / ADR-059). */
  contract: WidgetContract;
  /**
   * The placement's stored config text, or null (= the widget's defaults). A
   * body reads it ONLY through `parseWidgetConfig` against its own contract,
   * so every card's fallback discipline is the same one: an unreadable value
   * costs a per-field fallback to how the card ships, never a broken card.
   */
  config: string | null;
  onOpenModule: (id: string) => void;
  /**
   * Opens ONE note (021-e's reveal intent), for the widget whose rows name
   * notes. The same link STUDY's flashcards ride (ADR-017) — a row that names
   * a thing should land on that thing, and NOTE is the one module that already
   * has an intent saying so.
   */
  onOpenNote: (noteId: string) => void;
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
function TodayWidget({
  profileId,
  enabledModules,
  contract,
  config,
  onOpenModule,
}: DashboardWidgetBodyProps) {
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
  // CAL §5, read once per render — the same clock the day strip above this card
  // is drawn on, so one dashboard never shows two clocks at once.
  const clock = readStoredClock();

  return (
    <WidgetData state={state} retry={retry}>
      {({ events, people, tasks }) => {
        // An all-day event's bare "YYYY-MM-DD" sorts before any timed start,
        // matching the store. Recurring masters are expanded over today alone,
        // and each item's `event` is that occurrence's own copy, so the time
        // shown is the time it happens at.
        const items = buildCalendarItems(
          // `overlay` stays empty by design: the cross-profile read is the
          // calendar grid's alone (CAL-005) — no widget shows another profile.
          // `renewals` likewise: „Danas" is about the day's appointments, and
          // upcoming charges have their own card („Predstojeće naplate").
          {
            events,
            tasks: [],
            exams: [],
            blocks: [],
            subjects: [],
            people,
            overlay: [],
            renewals: [],
          },
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
        // The one knob this card has (ADR-059): a cap over the WHOLE row list,
        // in draw order — uncapped as shipped (the infinity default).
        const cfg = parseWidgetConfig(contract, config);
        const capped = capTodayGroups(
          widgetCount(cfg, "count"),
          todayEvents,
          todayBirthdays,
          todayTasks,
        );
        return (
          <div className="dash__list">
            {capped.events.map((item) => (
              <DashRow
                key={item.id}
                onClick={() => onOpenModule("calendar")}
                leading={<span className="dash__time">{formatEventTime(item.event, clock)}</span>}
              >
                <span className="dash__row-title">{item.event.title}</span>
              </DashRow>
            ))}
            {capped.birthdays.map((item) => (
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
            {capped.tasks.map((task) => (
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

/**
 * „Predstojeći zadaci" — active tasks by due date (nulls last), then age. The
 * most configurable card (ADR-059): a row cap, a period window (TASK's own
 * smart lists) and a task-list filter, all applied in `upcomingTaskRows` and
 * all defaulting to exactly the shipped card — the next five, no window, every
 * list.
 *
 * The lists snapshot rides the fetch for ONE reason: a selected list that no
 * longer exists must be dropped against the LIVE set (a dead selection falls
 * back to "all lists", never an error), and the task rows alone cannot answer
 * "which lists exist" — an empty list has no task to speak for it.
 */
function UpcomingTasksWidget({ profileId, contract, config, onOpenModule }: DashboardWidgetBodyProps) {
  const load = useCallback(async () => {
    const [tasks, taskLists] = await Promise.all([
      window.nexus.listTasks(profileId),
      window.nexus.listTaskLists(profileId),
    ]);
    return { tasks, liveListIds: new Set(taskLists.lists.map((list) => list.id)) };
  }, [profileId]);
  const { state, retry } = useWidgetData(load);
  const s = strings.dashboard.upcoming;

  return (
    <WidgetData state={state} retry={retry}>
      {({ tasks, liveListIds }) => {
        const cfg = parseWidgetConfig(contract, config, { liveTaskListIds: liveListIds });
        const upcoming = upcomingTaskRows(tasks, localTodayKey(), {
          cap: widgetCount(cfg, "count"),
          period: widgetChoice(cfg, "period"),
          listIds: widgetTaskLists(cfg, "lists"),
        });
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

/**
 * „Hitno i kasni" — TASK's „Kasni" and „Hitno" smart lists (ADR-049) read as
 * ONE card, because they answer one question together: what should already
 * have been done, and what is on fire.
 *
 * The union rule, in full (now `urgentTaskRows`): every late task first,
 * longest overdue leading, then every high-priority task that is not already
 * among them, earliest rok first (undated last) — the two lists' OWN orders,
 * `selectSmartList`'s. Five rows as shipped (configurable 3..10, ADR-059), so
 * a bad week reads as a handful of things to look at and not as a backlog;
 * that a late row can also be high priority is why the cap is on the union
 * rather than on each half.
 *
 * The predicates are `@nexus/core`'s, the very ones the two views run, so the
 * card and those views cannot drift on what "late" or "urgent" means.
 */
function UrgentTasksWidget({ profileId, contract, config, onOpenModule }: DashboardWidgetBodyProps) {
  const load = useCallback(() => window.nexus.listTasks(profileId), [profileId]);
  const { state, retry } = useWidgetData(load);
  const s = strings.dashboard.urgent;
  const todayKey = localTodayKey();

  return (
    <WidgetData state={state} retry={retry}>
      {(tasks) => {
        // The union rule lives in `urgentTaskRows` since ADR-059; the one knob
        // is the cap over the union, five as shipped.
        const cfg = parseWidgetConfig(contract, config);
        const rows = urgentTaskRows(tasks, todayKey, widgetCount(cfg, "count"));
        if (rows.length === 0) return <p className="dash__empty">{s.empty}</p>;
        return (
          <div className="dash__list">
            {rows.map((task) => {
              // TasksPage's own rok test (ADR-049), so one task reads the same
              // on both surfaces: a rok already past is danger, anything else
              // plain data. Its `!task.done` half is left out because neither
              // list admits a finished task — the row cannot be one.
              const overdue = task.dueDate !== null && task.dueDate.slice(0, 10) < todayKey;
              return (
                <DashRow
                  key={task.id}
                  onClick={() => onOpenModule("tasks")}
                  // TASK's own chip cluster, class and order included: prioritet
                  // then rok. The accent „Visok" is what says why a task with a
                  // rok still ahead is on a card about lateness, and a row here
                  // always carries at least one of the two — it is on the card
                  // because it is late (so it has a rok) or because it is high.
                  trailing={
                    <span className="tasks__chips">
                      {task.priority === "high" ? (
                        <Chip variant="accent">{strings.tasks.priority.high}</Chip>
                      ) : null}
                      {task.dueDate !== null ? (
                        <Chip variant={overdue ? "danger" : "data"}>
                          {formatDueDate(task.dueDate)}
                        </Chip>
                      ) : null}
                    </span>
                  }
                >
                  <span className="dash__row-title">{task.title}</span>
                </DashRow>
              );
            })}
          </div>
        );
      }}
    </WidgetData>
  );
}

/**
 * „Nedavne beleške" — the five notes touched most recently, each row landing on
 * the note itself through the reveal intent (021-e) rather than on the module.
 *
 * Ordered strictly by `updatedAt`: `listNotes` answers pinned-first, and a pin
 * is an organizing decision made on the notes page, never a claim about
 * recency — a note pinned last month leading a card called „Nedavne beleške"
 * would simply be false.
 */
function RecentNotesWidget({ profileId, contract, config, onOpenNote }: DashboardWidgetBodyProps) {
  const load = useCallback(() => window.nexus.listNotes(profileId), [profileId]);
  const { state, retry } = useWidgetData(load);
  const s = strings.dashboard.recentNotes;

  return (
    <WidgetData state={state} retry={retry}>
      {(notes) => {
        // Five as shipped; the cap is the card's one knob (ADR-059).
        const cfg = parseWidgetConfig(contract, config);
        // Copied before sorting: the array is this widget's loaded state, and
        // sorting it in place would be a render mutating what it renders.
        const recent = [...notes]
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id))
          .slice(0, widgetCount(cfg, "count"));
        if (recent.length === 0) return <p className="dash__empty">{s.empty}</p>;
        return (
          <div className="dash__list">
            {recent.map((note) => (
              <DashRow
                key={note.id}
                onClick={() => onOpenNote(note.id)}
                // "HH:MM" for a note touched today, "D. mon, HH:MM" otherwise —
                // the instant label NTF and the search results already use, so
                // a timestamp reads the same wherever the app shows one.
                trailing={
                  <span className="dash__days">{formatNotificationWhen(note.updatedAt)}</span>
                }
              >
                <span className="dash__row-title">
                  {note.title.trim().length > 0 ? note.title : strings.notes.untitled}
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
 * „Dokumenta koja ističu" — soonest first. As shipped („prag“), anything past
 * its own reminder threshold; the one knob (ADR-059) swaps that for a fixed
 * 30/60/90-day horizon (`expiringDocumentRows`).
 */
function ExpiringDocumentsWidget({ profileId, contract, config, onOpenModule }: DashboardWidgetBodyProps) {
  const load = useCallback(() => window.nexus.listDocuments(profileId), [profileId]);
  const { state, retry } = useWidgetData(load);
  const s = strings.dashboard.expiring;

  return (
    <WidgetData state={state} retry={retry}>
      {(documents) => {
        const cfg = parseWidgetConfig(contract, config);
        const expiring = expiringDocumentRows(documents, widgetChoice(cfg, "horizon"));
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
 * shown without a name. The one knob (ADR-059) narrows "upcoming" to a
 * 30/60/90-day horizon — every upcoming exam as shipped („svi“).
 */
function ExamsWidget({ profileId, contract, config, onOpenModule }: DashboardWidgetBodyProps) {
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
        const cfg = parseWidgetConfig(contract, config);
        const horizon = horizonWindowDays(widgetChoice(cfg, "horizon"));
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
          .filter((entry) => horizon === null || entry.days <= horizon)
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

/**
 * „Predstojeće naplate" (FIN slice d) — what the subscriptions' RULES say is
 * coming inside the chosen horizon, soonest first. Read from
 * `finUpcomingRenewals`, which expands each rule on the spot: a charge that has
 * not happened yet is not a transaction, so there is no row this card could
 * have read instead, and that is exactly why the balance beside it is not a
 * forecast.
 *
 * The amount carries its account's own currency, because there is no rate that
 * could fold two of them — the same rule the whole module is built on, applied
 * to a row that has to state one figure.
 */
function UpcomingRenewalsWidget({ profileId, contract, config, onOpenModule }: DashboardWidgetBodyProps) {
  // The widest window any horizon option asks for; the choice narrows it below,
  // so changing the knob never costs a second round trip.
  const load = useCallback(() => {
    const today = localTodayKey();
    return window.nexus.finUpcomingRenewals(profileId, {
      from: today,
      to: shiftDayKey(today, MAX_RENEWAL_HORIZON_DAYS),
    });
  }, [profileId]);
  const { state, retry } = useWidgetData(load);
  const s = strings.dashboard.renewals;

  return (
    <WidgetData state={state} retry={retry}>
      {(renewals) => {
        const cfg = parseWidgetConfig(contract, config);
        // Every option is a day count here (this card offers no „svi“ — an
        // endless subscription has infinitely many renewals ahead), so the
        // fallback is the shipped 30 rather than "no window".
        const horizon = horizonWindowDays(widgetChoice(cfg, "horizon")) ?? DEFAULT_RENEWAL_HORIZON_DAYS;
        const limit = shiftDayKey(localTodayKey(), horizon);
        const rows = renewals
          .filter((renewal) => renewal.date <= limit)
          .slice(0, widgetCount(cfg, "count"));
        if (rows.length === 0) return <p className="dash__empty">{s.empty}</p>;
        return (
          <div className="dash__list">
            {rows.map((renewal) => (
              <DashRow
                key={`${renewal.recurringId}@${renewal.date}`}
                onClick={() => onOpenModule("finance")}
                leading={<span className="dash__time">{formatDueDate(renewal.date)}</span>}
                trailing={
                  <Chip variant="data">{formatMoney(renewal.amount, renewal.currency)}</Chip>
                }
              >
                <span className="dash__row-title">{renewal.name}</span>
              </DashRow>
            ))}
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
  "tasks:hitno-kasni": { Body: UrgentTasksWidget, visible: (enabled) => enabled.has("tasks") },
  "calendar:isticanja": {
    Body: ExpiringDocumentsWidget,
    visible: (enabled) => enabled.has("calendar"),
  },
  "study:ispiti": { Body: ExamsWidget, visible: (enabled) => enabled.has("study") },
  "study:ucenje": { Body: StudyWidget, visible: (enabled) => enabled.has("study") },
  "notes:nedavno": { Body: RecentNotesWidget, visible: (enabled) => enabled.has("notes") },
  "finance:naplate": {
    Body: UpcomingRenewalsWidget,
    visible: (enabled) => enabled.has("finance"),
  },
};
