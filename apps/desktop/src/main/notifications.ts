import type { BrowserWindow } from "electron";
import { Notification, powerMonitor } from "electron";
import { deriveNotificationCandidates, isWithinQuietHours } from "@nexus/core";
import type { NotificationCandidate, NotificationSource, StudyDayReminderInput } from "@nexus/core";
import type {
  DocumentStore,
  Exam,
  ExamStore,
  NotificationStore,
  PlanStore,
  SubjectStore,
  TrackedDocument,
} from "@nexus/db";
import { localToday, localTime } from "./clock.js";
import {
  documentNotificationCopy,
  emptyDigestCounts,
  examNotificationCopy,
  groupedDigestCopy,
  studyDayNotificationCopy,
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
  examStore(profileId: string): ExamStore;
  subjectStore(profileId: string): SubjectStore;
  planStore(profileId: string): PlanStore;
  notificationStore(profileId: string): NotificationStore;
  getMainWindow(): BrowserWindow | null;
}

/** How often the periodic check runs, beyond the immediate on-start check and the `powerMonitor` "resume" hook. */
const CHECK_INTERVAL_MS = 60_000;

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
  const exams = deps.examStore(profileId).listActive();
  const subjects = deps.subjectStore(profileId).listActive();
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
    // CAL-006 event reminders are derived by the engine but not yet gathered
    // here: expanding a recurring master into the occurrences this array wants
    // is the scheduler's next slice.
    events: [],
    studyDays,
    enabledSources: settings.enabledSources,
    today,
    nowLocalTime: nowTime,
    morningHour: settings.morningHour,
  });

  const ledgerKeys = new Set(ntf.listLedgerKeys().map(occurrenceKey));
  const withinQuiet = isWithinQuietHours(nowTime, settings.quietFrom, settings.quietTo);

  const documentsById = new Map(documents.map((doc) => [doc.id, doc]));
  const examsById = new Map(exams.map((exam) => [exam.id, exam]));
  const subjectNameById = new Map(subjects.map((subject) => [subject.id, subject.name]));
  const studyDaysByDate = new Map(studyDays.map((day) => [day.date, day]));

  const toShow: Array<{ source: NotificationSource; copy: NotificationCopy }> = [];
  let ledgerChanged = false;

  for (const candidate of candidates) {
    if (ledgerKeys.has(occurrenceKey(candidate))) continue; // already recorded, in any status
    if (candidate.priority !== "max" && withinQuiet) continue; // held; re-derives once quiet hours end

    const copy = composeCopy(candidate, { documentsById, examsById, subjectNameById, studyDaysByDate, today });
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
  examsById: Map<string, Exam>;
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
  if (candidate.source === "event") return null; // CAL-006 copy lands with the scheduler's next slice
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
