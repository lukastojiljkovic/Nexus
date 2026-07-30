import type { BrowserWindow } from "electron";
import { Notification, powerMonitor } from "electron";
import {
  deriveNotificationCandidates,
  isValidDayKey,
  isWithinQuietHours,
  occurrenceDatesInRange,
  shiftDayKey,
} from "@nexus/core";
import type {
  EventReminderInput,
  NotificationCandidate,
  NotificationSource,
  StudyDayReminderInput,
  TaskReminderInput,
} from "@nexus/core";
import type {
  DocumentStore,
  Event,
  EventStore,
  Exam,
  ExamStore,
  NotificationStore,
  PlanStore,
  SubjectStore,
  Task,
  TaskStore,
  TrackedDocument,
} from "@nexus/db";
import { localToday, localTime } from "./clock.js";
import {
  documentNotificationCopy,
  emptyDigestCounts,
  eventNotificationCopy,
  examNotificationCopy,
  groupedDigestCopy,
  studyDayNotificationCopy,
  taskNotificationCopy,
  type NotificationCopy,
} from "./notificationStrings.js";
import { IpcChannel } from "../shared/ipc.js";

/**
 * Everything the scheduler reads/writes through, as plain functions rather
 * than a direct `requireDb()` dependency — keeps this module decoupled from
 * `main/index.ts`'s module-level `db`/`mainWindow` state, and makes every
 * store swap explicit at the call site in `index.ts`.
 */
export interface NotificationSchedulerDeps {
  listProfiles(): ReadonlyArray<{ id: string }>;
  documentStore(profileId: string): DocumentStore;
  eventStore(profileId: string): EventStore;
  examStore(profileId: string): ExamStore;
  subjectStore(profileId: string): SubjectStore;
  planStore(profileId: string): PlanStore;
  taskStore(profileId: string): TaskStore;
  notificationStore(profileId: string): NotificationStore;
  getMainWindow(): BrowserWindow | null;
}

/** How often the periodic check runs, beyond the immediate on-start check and the `powerMonitor` "resume" hook. */
const CHECK_INTERVAL_MS = 60_000;

const MINUTES_PER_DAY = 1_440;

/** At most this many notifications show individually; more than this collapses into one grouped digest (the storm guard). */
const GROUP_THRESHOLD = 3;

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let resumeListener: (() => void) | null = null;

/**
 * Starts the periodic reminder check (NTF piece a2): runs one check
 * immediately, then every `CHECK_INTERVAL_MS`, plus once more whenever the OS
 * reports a resume from sleep (a reminder that came due while asleep should
 * not wait a full minute). Idempotent — calling it again first stops any
 * previous scheduler, so there is never more than one interval/listener.
 * Never call this during the `--smoke` run (see `main/index.ts`): a
 * background check firing mid-smoke would make the deterministic exit flaky.
 */
export function startNotificationScheduler(deps: NotificationSchedulerDeps): void {
  stopNotificationScheduler();
  runNotificationCheck(deps);
  intervalHandle = setInterval(() => runNotificationCheck(deps), CHECK_INTERVAL_MS);
  resumeListener = () => runNotificationCheck(deps);
  powerMonitor.on("resume", resumeListener);
}

/** Stops the periodic check and the resume hook. Safe to call even if nothing was started. */
export function stopNotificationScheduler(): void {
  if (intervalHandle !== null) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  if (resumeListener !== null) {
    powerMonitor.removeListener("resume", resumeListener);
    resumeListener = null;
  }
}

/**
 * Runs one reminder check across every profile. Never throws — a failure
 * (this profile's or the listing itself) is logged and the check simply
 * retries on the next cycle, so one bad read never takes down the interval.
 */
export function runNotificationCheck(deps: NotificationSchedulerDeps): void {
  let profiles: ReadonlyArray<{ id: string }>;
  try {
    profiles = deps.listProfiles();
  } catch (error) {
    logCheckFailure(error);
    return;
  }

  const nowIso = new Date().toISOString();
  const today = localToday();
  const nowTime = localTime();

  // Every profile is checked today because there is effectively only one
  // (personal). Once profile switching lands (AUTH), the NTF PRD's
  // cross-profile discretion rule applies here (PRD 05 §7, "Profile
  // separation"): a non-active profile's notifications should not render as
  // OS toasts while another profile is active, beyond a neutral badge — so
  // this loop will need an "active profile" concept to scope which
  // profile(s) actually fire OS notifications on a given check.
  for (const profile of profiles) {
    try {
      checkProfile(deps, profile.id, nowIso, today, nowTime);
    } catch (error) {
      logCheckFailure(error);
    }
  }
}

function logCheckFailure(error: unknown): void {
  console.error(
    `Notification check failed (benign, retried next cycle): ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
}

/**
 * The "HH:MM" wall-clock part of an ISO start, or null when the row does not
 * carry a real one. Mirrors `calendarItems.ts`: a malformed row is skipped, not
 * thrown on — one bad event must never take down the whole check.
 */
function startClock(startAt: string): string | null {
  const time = startAt.slice(11, 16);
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : null;
}

/**
 * The events of one profile in the engine's one-row-per-occurrence shape
 * (CAL-006): expansion is the scheduler's job, since the engine deliberately
 * knows nothing about recurrence. An event with no reminders contributes
 * nothing, and a row whose stored start is not a usable day/time is skipped
 * rather than crashing the check.
 *
 * A ruled master is expanded from **today forward** only, far enough that every
 * occurrence whose reminder could already be due is included: the longest lead
 * time this event carries, rounded up to whole days, plus one for the day the
 * lead time itself lands mid-way through. Nothing before today is needed, and
 * that is worth stating because "yesterday's 20:00 occurrence with a 12-hour
 * lead" looks like a counter-example: it is not, because such a reminder is
 * only ever relevant while the occurrence has NOT started yet (see the engine's
 * `relevant` for a timed occurrence), and an occurrence dated before today has
 * necessarily already started. The same holds for all-day occurrences, which
 * stay relevant only through their own day.
 */
function eventReminderInputs(events: readonly Event[], today: string): EventReminderInput[] {
  const rows: EventReminderInput[] = [];
  for (const event of events) {
    if (event.reminderOffsets.length === 0) continue;

    const anchor = event.startAt.slice(0, 10);
    if (!isValidDayKey(anchor)) continue;
    const startTime = event.allDay ? null : startClock(event.startAt);
    if (!event.allDay && startTime === null) continue;

    if (event.recurrence === null) {
      rows.push({
        id: event.id,
        occurrenceDate: anchor,
        startTime,
        reminderOffsets: event.reminderOffsets,
      });
      continue;
    }

    const forwardDays = Math.ceil(Math.max(...event.reminderOffsets) / MINUTES_PER_DAY) + 1;
    const dates = occurrenceDatesInRange(
      event.recurrence,
      anchor,
      { from: today, to: shiftDayKey(today, forwardDays) },
      new Set(event.recurrenceExdates),
    );
    for (const occurrenceDate of dates) {
      rows.push({
        id: event.id,
        occurrenceDate,
        startTime,
        reminderOffsets: event.reminderOffsets,
      });
    }
  }
  return rows;
}

/**
 * The tasks of one profile in the engine's reminder shape (ADR-028). Only rows
 * that can actually produce an occurrence travel: a task that is already done
 * has nothing left to remind about, and one with an empty ladder was never set
 * to remind. (Soft-deleted rows never appear at all — `listActive` excludes
 * them.)
 *
 * The due-date check is the same defensive skip `eventReminderInputs` makes of
 * a malformed start: a days-before ladder has nothing to count back from unless
 * the due date is a bare day, and while `TaskStore` refuses to WRITE that pair,
 * a row can reach the table by another route (a restored archive). One such row
 * costs a skipped reminder rather than the whole check.
 *
 * Unlike events there is no expansion and no forward window, because the row's
 * CURRENT due date is the only occurrence that can ever be due: a recurring
 * task's series lives in its own advance (ADR-024) — completing an occurrence
 * moves this very row to the next date, which re-keys its reminders for free.
 */
function taskReminderInputs(tasks: readonly Task[]): TaskReminderInput[] {
  const rows: TaskReminderInput[] = [];
  for (const task of tasks) {
    if (task.done || task.reminderOffsets.length === 0) continue;
    if (task.dueDate === null || !isValidDayKey(task.dueDate)) continue;
    rows.push({
      id: task.id,
      dueDate: task.dueDate,
      reminderOffsets: task.reminderOffsets,
    });
  }
  return rows;
}

/** One profile's worth of the check: sync plans, derive candidates, fire/record survivors, re-fire or dismiss snoozed rows. */
function checkProfile(
  deps: NotificationSchedulerDeps,
  profileId: string,
  nowIso: string,
  today: string,
  nowTime: string,
): void {
  const plans = deps.planStore(profileId);
  plans.syncAll(nowIso, today); // keeps today's planned blocks current; idempotent, safe to re-run every check

  const ntf = deps.notificationStore(profileId);
  const settings = ntf.getSettings();

  const documents = deps.documentStore(profileId).listActive();
  const events = deps.eventStore(profileId).listActive();
  const exams = deps.examStore(profileId).listActive();
  const subjects = deps.subjectStore(profileId).listActive();
  const tasks = deps.taskStore(profileId).listActive();
  const todaysBlocks = plans
    .listBlocksInRange(today, today)
    .filter((block) => block.status === "planned");

  const studyDays: StudyDayReminderInput[] =
    todaysBlocks.length === 0
      ? []
      : [
          {
            date: today,
            blockCount: todaysBlocks.length,
            totalMinutes: todaysBlocks.reduce((sum, block) => sum + block.minutes, 0),
          },
        ];

  const candidates = deriveNotificationCandidates({
    documents: documents.map((doc) => ({
      id: doc.id,
      expiryDate: doc.expiryDate,
      reminderOffsets: doc.reminderOffsets,
    })),
    exams: exams.map((exam) => ({ id: exam.id, examDate: exam.examDate })),
    events: eventReminderInputs(events, today),
    studyDays,
    tasks: taskReminderInputs(tasks),
    enabledSources: settings.enabledSources,
    today,
    nowLocalTime: nowTime,
    morningHour: settings.morningHour,
  });

  const ledgerKeys = new Set(ntf.listLedgerKeys().map(occurrenceKey));
  const withinQuiet = isWithinQuietHours(nowTime, settings.quietFrom, settings.quietTo);

  const documentsById = new Map(documents.map((doc) => [doc.id, doc]));
  const eventsById = new Map(events.map((event) => [event.id, event]));
  const examsById = new Map(exams.map((exam) => [exam.id, exam]));
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const subjectNameById = new Map(subjects.map((subject) => [subject.id, subject.name]));
  const studyDaysByDate = new Map(studyDays.map((day) => [day.date, day]));

  const toShow: Array<{ source: NotificationSource; copy: NotificationCopy }> = [];
  let ledgerChanged = false;

  for (const candidate of candidates) {
    if (ledgerKeys.has(occurrenceKey(candidate))) continue; // already recorded, in any status
    if (candidate.priority !== "max" && withinQuiet) continue; // held; re-derives once quiet hours end

    const copy = composeCopy(candidate, {
      documentsById,
      eventsById,
      examsById,
      tasksById,
      subjectNameById,
      studyDaysByDate,
      today,
    });
    if (!copy) continue; // entity vanished between the reads above and here — skip, never crash

    ntf.recordDelivered(
      {
        source: candidate.source,
        entityId: candidate.entityId,
        occurrenceKey: candidate.occurrenceKey,
        title: copy.title,
        body: copy.body,
      },
      nowIso,
    );
    toShow.push({ source: candidate.source, copy });
    ledgerChanged = true;
  }

  const currentKeys = new Set(candidates.map(occurrenceKey));
  for (const row of ntf.dueSnoozed(nowIso)) {
    if (currentKeys.has(occurrenceKey(row))) {
      const refired = ntf.markRefired(row.id, nowIso);
      toShow.push({ source: row.source, copy: { title: refired.title, body: refired.body } });
    } else {
      ntf.dismiss(row.id, nowIso); // the entity behind it is gone/stale — silent, per the PRD
    }
    ledgerChanged = true;
  }

  showNotifications(deps, toShow);

  if (ledgerChanged) {
    deps.getMainWindow()?.webContents.send(IpcChannel.notificationsChanged);
  }
}

/** The (source, entityId, occurrenceKey) identity shared by candidates, ledger keys, and ledger rows. */
function occurrenceKey(entry: { source: string; entityId: string; occurrenceKey: string }): string {
  return `${entry.source} ${entry.entityId} ${entry.occurrenceKey}`;
}

interface CopyContext {
  documentsById: Map<string, TrackedDocument>;
  eventsById: Map<string, Event>;
  examsById: Map<string, Exam>;
  tasksById: Map<string, Task>;
  subjectNameById: Map<string, string>;
  studyDaysByDate: Map<string, StudyDayReminderInput>;
  today: string;
}

/** Builds one candidate's Serbian copy, joining through the entity lookups. `null` if the entity vanished mid-check. */
function composeCopy(candidate: NotificationCandidate, ctx: CopyContext): NotificationCopy | null {
  if (candidate.source === "document") {
    const doc = ctx.documentsById.get(candidate.entityId);
    if (!doc) return null;
    return documentNotificationCopy(doc.label, doc.expiryDate, ctx.today, candidate.priority === "max");
  }
  if (candidate.source === "exam") {
    const exam = ctx.examsById.get(candidate.entityId);
    if (!exam) return null;
    const subjectName = ctx.subjectNameById.get(exam.subjectId) ?? "Predmet";
    return examNotificationCopy(subjectName, exam.examType, candidate.occurrenceKey === "d-0" ? "d-0" : "d-1");
  }
  if (candidate.source === "event") {
    const event = ctx.eventsById.get(candidate.entityId);
    if (!event) return null;
    // The engine's own documented occurrence key: "<occurrenceDate> <offset>".
    // Which occurrence of a series this is cannot be read off the row — the row
    // is the master — so it is read back out of the key that identified it.
    const [occurrenceDate, offsetMinutes] = candidate.occurrenceKey.split(" ");
    if (occurrenceDate === undefined || offsetMinutes === undefined) return null;
    return eventNotificationCopy(
      event.title,
      occurrenceDate,
      ctx.today,
      event.allDay ? null : startClock(event.startAt),
      Number(offsetMinutes),
    );
  }
  if (candidate.source === "task") {
    const task = ctx.tasksById.get(candidate.entityId);
    if (!task) return null;
    // The engine's own documented occurrence key: "<dueDate> <offset>". Both
    // halves are read back out of the key, exactly as the event branch does:
    // the offset is nowhere else, and the due date is the one this occurrence
    // was derived for — which matters because a recurring task advances IN
    // PLACE (ADR-024), so the row's own `dueDate` is a moving target while the
    // key is the fixed identity the ledger already recorded under.
    const [dueDate, offsetDays] = candidate.occurrenceKey.split(" ");
    if (dueDate === undefined || offsetDays === undefined) return null;
    return taskNotificationCopy(task.title, dueDate, ctx.today, Number(offsetDays));
  }
  const day = ctx.studyDaysByDate.get(candidate.entityId);
  if (!day) return null;
  return studyDayNotificationCopy(day.blockCount, day.totalMinutes);
}

/**
 * Shows a batch of notifications from one check: individually when at most
 * `GROUP_THRESHOLD`, otherwise a single grouped digest (every occurrence was
 * already recorded individually in the ledger regardless of how it is
 * shown). Guards `Notification.isSupported()` once for the whole batch.
 */
function showNotifications(
  deps: NotificationSchedulerDeps,
  items: ReadonlyArray<{ source: NotificationSource; copy: NotificationCopy }>,
): void {
  if (items.length === 0 || !Notification.isSupported()) return;

  if (items.length <= GROUP_THRESHOLD) {
    for (const item of items) showOne(deps, item.copy);
    return;
  }

  const counts = emptyDigestCounts();
  for (const item of items) counts[item.source] += 1;
  showOne(deps, groupedDigestCopy(items.length, counts));
}

function showOne(deps: NotificationSchedulerDeps, copy: NotificationCopy): void {
  const notification = new Notification({ title: copy.title, body: copy.body });
  notification.on("click", () => {
    const win = deps.getMainWindow();
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  notification.show();
}
