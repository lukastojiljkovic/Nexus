import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { computeStreak } from "@nexus/core";
import { Card, Chip, EmptyState, ListRow } from "@nexus/ui";
import type {
  AppInfo,
  DocumentStatus,
  Event,
  Exam,
  FocusSession,
  StudyStats,
  Subject,
  Task,
  TrackedDocument,
} from "../../shared/ipc.js";
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

// --- Formatting helpers (renderer-local, mirror the module pages) -----------
//
// DASH is a pure aggregation surface: it reads the same tasks/events/documents
// the modules own and reformats them into "šta mi je danas bitno?" cards. The
// date rules match the pages exactly — wall-clock ("today") is local, while a
// bare calendar date (a due date, an all-day start) is treated as UTC so it does
// not shift a day back when formatted in a negative-offset timezone.

/** Local wall-clock day key "YYYY-MM-DD" — matches how the pages read "today". */
function localDayKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Time-of-day salutation, personalized with the profile name when present. */
function greeting(name: string, hour: number): string {
  const g = strings.dashboard.greeting;
  const salutation = hour < 12 ? g.jutro : hour < 18 ? g.dan : g.vece;
  const trimmed = name.trim();
  return trimmed.length > 0 ? `${salutation}, ${trimmed}` : salutation;
}

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

export interface DashboardPageProps {
  profileId: string;
  profileName: string;
  info: AppInfo | null;
  onOpenModule: (id: string) => void;
}

/**
 * The DASH home surface (DASH v0): a personalized greeting over three read-only
 * widget cards that aggregate the data the modules already own — today's agenda,
 * the next tasks, and documents nearing expiry — each row deep-linking into its
 * module. Nothing here writes; it composes over the existing `window.nexus`
 * reads. The system-diagnostics card stays at the bottom as the human-visible
 * proof of the renderer -> main -> DB path (and what the --smoke harness loads).
 */
export function DashboardPage({ profileId, profileName, info, onOpenModule }: DashboardPageProps) {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [events, setEvents] = useState<Event[] | null>(null);
  const [documents, setDocuments] = useState<TrackedDocument[] | null>(null);
  const [subjects, setSubjects] = useState<Subject[] | null>(null);
  const [exams, setExams] = useState<Exam[] | null>(null);
  // Učenje widget: a 365-day stats window backs the streak (mirrors StudyPage's
  // `statsYear`), and today's completed focus sessions back the focus minutes
  // (a running timer deliberately doesn't count — only `listFocusRange`'s
  // persisted, completed sessions).
  const [studyStats, setStudyStats] = useState<StudyStats | null>(null);
  const [todayFocusSessions, setTodayFocusSessions] = useState<FocusSession[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const today = localTodayKey();
        const [
          nextTasks,
          nextEvents,
          nextDocuments,
          nextSubjects,
          nextExams,
          nextStudyStats,
          nextTodayFocusSessions,
        ] = await Promise.all([
          window.nexus.listTasks(profileId),
          window.nexus.listEvents(profileId),
          window.nexus.listDocuments(profileId),
          window.nexus.listSubjects(profileId),
          window.nexus.listExams(profileId),
          window.nexus.studyStats(profileId, shiftDayKey(today, -365), today),
          window.nexus.listFocusRange(profileId, today, today),
        ]);
        if (!active) return;
        setTasks(nextTasks);
        setEvents(nextEvents);
        setDocuments(nextDocuments);
        setSubjects(nextSubjects);
        setExams(nextExams);
        setStudyStats(nextStudyStats);
        setTodayFocusSessions(nextTodayFocusSessions);
      } catch (error) {
        if (active) setFailed(true);
        console.error("Nexus: failed to load dashboard:", error);
      }
    })();
    return () => {
      active = false;
    };
  }, [profileId]);

  const now = new Date();
  const todayKey = localDayKey(now);
  const dateLine = new Intl.DateTimeFormat("sr-Latn", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(now);

  // All seven resolve together, so a single null is enough to mean "loading".
  const loading =
    tasks === null ||
    events === null ||
    documents === null ||
    subjects === null ||
    exams === null ||
    studyStats === null ||
    todayFocusSessions === null;

  // Danas — today's events (chronological) then tasks due today. An all-day
  // event's bare "YYYY-MM-DD" sorts before any timed start, matching the store.
  const todayEvents = (events ?? [])
    .filter((event) => event.startAt.slice(0, 10) === todayKey)
    .sort((a, b) => a.startAt.localeCompare(b.startAt) || a.id.localeCompare(b.id));
  const todayTasks = (tasks ?? []).filter(
    (task) => !task.done && task.dueDate != null && task.dueDate.slice(0, 10) === todayKey,
  );
  const hasToday = todayEvents.length > 0 || todayTasks.length > 0;

  // Predstojeći zadaci — next 5 active tasks by due date (nulls last), then age.
  const upcomingTasks = (tasks ?? [])
    .filter((task) => !task.done)
    .sort((a, b) => {
      if (a.dueDate == null && b.dueDate == null) return a.createdAt.localeCompare(b.createdAt);
      if (a.dueDate == null) return 1;
      if (b.dueDate == null) return -1;
      return a.dueDate.localeCompare(b.dueDate) || a.createdAt.localeCompare(b.createdAt);
    })
    .slice(0, 5);

  // Dokumenta koja ističu — anything past the reminder threshold, soonest first.
  const expiringDocuments = (documents ?? [])
    .filter((doc) => doc.status !== "ok")
    .sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry || a.id.localeCompare(b.id));

  // Ispiti — the next upcoming exams (today or later), soonest first, capped at
  // 5. An orphaned exam (its subject was soft-deleted) is skipped rather than
  // shown without a name.
  const subjectsById = new Map((subjects ?? []).map((subject) => [subject.id, subject] as const));
  const upcomingExams = (exams ?? [])
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

  // Učenje — the study streak (same 365-day-window rule as StudyPage) and
  // today's completed focus minutes; either can be zero independently, and
  // the widget shows the gentle zero copy only when both are.
  const streak = studyStats ? computeStreak(studyStats.activityDays, todayKey) : null;
  const focusMinutesToday = (todayFocusSessions ?? []).reduce(
    (total, session) => total + focusSessionMinutes(session),
    0,
  );
  const hasStreak = streak != null && streak.current > 0;
  const hasFocusToday = focusMinutesToday > 0;

  return (
    <div className="dash">
      <header className="dash__greeting">
        <h1 className="dash__hello">{greeting(profileName, now.getHours())}</h1>
        <p className="dash__date">{dateLine}</p>
      </header>

      {failed ? (
        <EmptyState
          title={strings.dashboard.errorTitle}
          description={strings.dashboard.errorDescription}
        />
      ) : loading ? (
        <p className="app__muted">{strings.app.loading}</p>
      ) : (
        <div className="dash__grid">
          <Card title={strings.dashboard.today.title}>
            {hasToday ? (
              <div className="dash__list">
                {todayEvents.map((event) => (
                  <DashRow
                    key={`event-${event.id}`}
                    onClick={() => onOpenModule("calendar")}
                    leading={<span className="dash__time">{formatEventTime(event)}</span>}
                  >
                    <span className="dash__row-title">{event.title}</span>
                  </DashRow>
                ))}
                {todayTasks.map((task) => (
                  <DashRow
                    key={`task-${task.id}`}
                    onClick={() => onOpenModule("tasks")}
                    leading={
                      <span className="dash__time dash__time--tag">
                        {strings.dashboard.today.taskTag}
                      </span>
                    }
                  >
                    <span className="dash__row-title">{task.title}</span>
                  </DashRow>
                ))}
              </div>
            ) : (
              <p className="dash__empty">{strings.dashboard.today.empty}</p>
            )}
          </Card>

          <Card title={strings.dashboard.upcoming.title}>
            {upcomingTasks.length > 0 ? (
              <div className="dash__list">
                {upcomingTasks.map((task) => (
                  <DashRow
                    key={task.id}
                    onClick={() => onOpenModule("tasks")}
                    trailing={
                      task.dueDate ? (
                        <Chip variant="data">{formatDueDate(task.dueDate)}</Chip>
                      ) : undefined
                    }
                  >
                    <span className="dash__row-title">{task.title}</span>
                  </DashRow>
                ))}
              </div>
            ) : (
              <p className="dash__empty">{strings.dashboard.upcoming.empty}</p>
            )}
          </Card>

          <Card title={strings.dashboard.expiring.title}>
            {expiringDocuments.length > 0 ? (
              <div className="dash__list">
                {expiringDocuments.map((doc) => (
                  <DashRow
                    key={doc.id}
                    onClick={() => onOpenModule("calendar")}
                    leading={
                      <Chip variant={STATUS_VARIANT[doc.status]}>
                        {strings.documents.status[doc.status]}
                      </Chip>
                    }
                    trailing={
                      <span className="dash__days">{daysUntilLabel(doc.daysUntilExpiry)}</span>
                    }
                  >
                    <span className="dash__doc">
                      <span className="dash__doc-type">{strings.documents.type[doc.docType]}</span>
                      <span className="dash__doc-label">{doc.label}</span>
                    </span>
                  </DashRow>
                ))}
              </div>
            ) : (
              <p className="dash__empty">{strings.dashboard.expiring.empty}</p>
            )}
          </Card>

          <Card title={strings.study.dashboardTitle}>
            {upcomingExams.length > 0 ? (
              <div className="dash__list">
                {upcomingExams.map(({ exam, subject, days }) => (
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
            ) : (
              <p className="dash__empty">{strings.study.dashboardEmpty}</p>
            )}
          </Card>

          <Card title={strings.study.dashboardStudyTitle}>
            {hasStreak || hasFocusToday ? (
              <div className="dash__list">
                <DashRow onClick={() => onOpenModule("study")}>
                  <span className="dash__study">
                    {hasStreak && streak && (
                      <span className="dash__study-line">
                        {strings.study.streakLabel}: {streak.current}{" "}
                        {dayUnit(streak.current, strings.study.streakUnitOne, strings.study.streakUnitMany)}
                      </span>
                    )}
                    {hasFocusToday && (
                      <span className="dash__study-line">
                        {strings.study.dashboardFocusTodayLabel}: {formatDurationMinutes(focusMinutesToday)}
                      </span>
                    )}
                  </span>
                </DashRow>
              </div>
            ) : (
              <p className="dash__empty">{strings.study.streakZero}</p>
            )}
          </Card>
        </div>
      )}

      <Card title={strings.diagnostics.title} className="dash__diagnostics">
        {info ? (
          <dl className="app__facts">
            <div>
              <dt>{strings.diagnostics.version}</dt>
              <dd>
                {info.name} {info.version}
              </dd>
            </div>
            <div>
              <dt>{strings.diagnostics.electron}</dt>
              <dd>{info.versions.electron}</dd>
            </div>
            <div>
              <dt>{strings.diagnostics.chromium}</dt>
              <dd>{info.versions.chrome}</dd>
            </div>
            <div>
              <dt>{strings.diagnostics.node}</dt>
              <dd>{info.versions.node}</dd>
            </div>
            <div>
              <dt>{strings.diagnostics.database}</dt>
              <dd className="app__path">{info.databasePath}</dd>
            </div>
          </dl>
        ) : (
          <p className="app__muted">{strings.app.loading}</p>
        )}
      </Card>
    </div>
  );
}
