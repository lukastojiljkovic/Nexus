import type { BrowserWindow } from "electron";
import { Notification, powerMonitor } from "electron";
import {
  coalesceDeliveries,
  deriveNotificationCandidates,
  emptyDeliveryWindow,
  isDeliverable,
  isValidDayKey,
  isWithinQuietHours,
  occurrenceDatesInRange,
  shiftDayKey,
} from "@nexus/core";
import type {
  DeliveryWindow,
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
  catchUpDigestCopy,
  documentNotificationCopy,
  emptyDigestCounts,
  eventNotificationCopy,
  examNotificationCopy,
  groupedDigestCopy,
  securityNotificationCopy,
  studyDayNotificationCopy,
  taskNotificationCopy,
  windowDigestCopy,
  type NotificationCopy,
  type SecurityNotice,
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

/**
 * What recording a security event needs (NTF-007) — a strict subset of the
 * scheduler's deps, because a security notice is not derived from anything: it
 * has already happened, so there are no source stores to read. Spelled as a
 * `Pick` rather than a second literal so `main/index.ts` can hand the very same
 * object to both.
 */
export type SecurityNotificationDeps = Pick<
  NotificationSchedulerDeps,
  "listProfiles" | "notificationStore" | "getMainWindow"
>;

/** How often the periodic check runs, beyond the immediate on-start check and the `powerMonitor` "resume" hook. */
const CHECK_INTERVAL_MS = 60_000;

const MINUTES_PER_DAY = 1_440;

/** One notification as the toast path handles it: what it is about, and the exact text that was recorded for it. */
interface ToastItem {
  source: NotificationSource;
  copy: NotificationCopy;
}

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let resumeListener: (() => void) | null = null;
/**
 * The rolling coalescing window (NTF-009), carried between passes. Module-level
 * rather than per profile because it is about the OS toast stream, and there is
 * exactly one of those: the user is one person however many profiles they keep,
 * so two profiles delivering within the same 90 seconds should interrupt them
 * once, not twice. (`deliverSecurityNotices` already reasons the same way.)
 * Reset whenever a scheduler starts or stops — a session that has just been
 * unlocked has interrupted nobody yet.
 */
let deliveryWindow: DeliveryWindow<ToastItem> = emptyDeliveryWindow();
/**
 * Whether the next delivering pass is the FIRST one of this session (PRD 05
 * §5). Set when the scheduler starts — that is, at unlock — and consumed by the
 * first pass that actually reaches the delivery stage, which is what makes the
 * catch-up wording honest: everything it shows came due while the app was
 * closed. A pass held back for the NTF-008 appetite ask returns before that
 * point and so does not consume it; a pass that reaches delivery with nothing
 * to show consumes it anyway, because a reminder arriving a minute later is not
 * a catch-up.
 */
let launchPassPending = false;
/**
 * The deps of the currently RUNNING scheduler, so a check can be triggered from
 * outside without every caller rebuilding the whole store bundle (NTF-008: the
 * appetite answer runs one immediately, so the reminders it held back fire
 * under the chosen appetite rather than waiting out the next tick). Null
 * whenever no scheduler is running — a locked session has no stores to read.
 */
let activeDeps: NotificationSchedulerDeps | null = null;

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
  activeDeps = deps;
  launchPassPending = true;
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
  activeDeps = null;
  deliveryWindow = emptyDeliveryWindow();
  launchPassPending = false;
}

/**
 * Whether this is the session's first delivering pass, clearing the flag as it
 * answers — so the catch-up wording is used once, ever, per unlock. Called at
 * the delivery stage rather than at the top of a check, deliberately: see
 * `launchPassPending`.
 */
function consumeLaunchPass(): boolean {
  const launch = launchPassPending;
  launchPassPending = false;
  return launch;
}

/**
 * Runs one check right now against the running scheduler's own deps — the seam
 * the NTF-008 appetite answer uses so the reminders that were held for the ask
 * fire immediately under the appetite just chosen. A no-op when no scheduler is
 * running (a locked session, or the smoke run, which never starts one), which
 * is also why it takes no deps: there is nothing sensible to check against
 * without the session the scheduler was started for.
 */
export function runCheckNow(): void {
  if (activeDeps === null) return;
  runNotificationCheck(activeDeps);
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

  // One clock read for the whole pass: the ISO stamp the ledger records under
  // and the epoch ms the coalescing window measures against are the same
  // instant, so a batch can never look like it straddled two.
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
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
      checkProfile(deps, profile.id, nowIso, nowMs, today, nowTime);
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

/**
 * One profile's worth of the check: sync plans, derive candidates, fire/record
 * survivors, re-fire or dismiss snoozed rows — unless this is the profile's
 * first visible reminder moment and the NTF-008 appetite question is still
 * unanswered, in which case the whole cycle is held and the question is pushed
 * instead (see the block below).
 */
function checkProfile(
  deps: NotificationSchedulerDeps,
  profileId: string,
  nowIso: string,
  nowMs: number,
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
  const currentKeys = new Set(candidates.map(occurrenceKey));

  // Everything this cycle would actually put in front of the user, decided
  // before anything is written: fresh candidates that clear both the ledger and
  // the quiet-hours gate, plus snoozed rows whose time is up and whose source
  // entity is still due. Splitting the decision from the delivery is what lets
  // the NTF-008 ask below hold a cycle without having recorded half of it.
  const fresh = candidates.filter(
    (candidate) =>
      !ledgerKeys.has(occurrenceKey(candidate)) &&
      // held; re-derives once quiet hours end
      isDeliverable(candidate, {
        enabledSources: settings.enabledSources,
        withinQuietHours: withinQuiet,
      }),
  );
  const dueSnoozed = ntf.dueSnoozed(nowIso);
  const refiring = dueSnoozed.filter((row) => currentKeys.has(occurrenceKey(row)));

  // NTF-008 (ADR-033): the one-time "how much should Nexus remind you" ask, put
  // at the first moment it is actually about to remind — the only moment where
  // the question means anything — and ONLY when there is a window to see it in.
  // Holding is free for exactly the reason quiet hours are free: nothing is
  // materialized, so a held cycle simply re-derives on the next one. When the
  // window is hidden or minimized the reminder wins instead and the flag stays
  // unset, so the ask waits for the next VISIBLE delivery moment: a reminder is
  // never held hostage by a dialog nobody can see.
  //
  // The push is payload-free, so the renderer answers for the profile it is
  // showing. That is exact while there is one profile (see the loop comment in
  // `runNotificationCheck`), and it is the SAME assumption the surrounding loop
  // already makes — but it fails harder: an ask raised for a non-active profile
  // would be answered for the active one, leaving the first still unasked and
  // its cycle held on every future check. Whoever lands profile switching must
  // scope this ask along with the rest of the loop.
  if (!settings.appetiteAsked && (fresh.length > 0 || refiring.length > 0)) {
    const visibleWindow = visibleMainWindow(deps);
    if (visibleWindow) {
      visibleWindow.webContents.send(IpcChannel.notificationsAppetiteAsk);
      return; // nothing recorded, nothing fired — the whole cycle re-derives
    }
  }

  const documentsById = new Map(documents.map((doc) => [doc.id, doc]));
  const eventsById = new Map(events.map((event) => [event.id, event]));
  const examsById = new Map(exams.map((exam) => [exam.id, exam]));
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const subjectNameById = new Map(subjects.map((subject) => [subject.id, subject.name]));
  const studyDaysByDate = new Map(studyDays.map((day) => [day.date, day]));

  const toShow: ToastItem[] = [];
  let ledgerChanged = false;

  for (const candidate of fresh) {
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

  for (const row of dueSnoozed) {
    if (currentKeys.has(occurrenceKey(row))) {
      const refired = ntf.markRefired(row.id, nowIso);
      toShow.push({ source: row.source, copy: { title: refired.title, body: refired.body } });
    } else {
      ntf.dismiss(row.id, nowIso); // the entity behind it is gone/stale — silent, per the PRD
    }
    ledgerChanged = true;
  }

  showNotifications(deps, toShow, { now: nowMs, launch: consumeLaunchPass() });

  if (ledgerChanged) {
    deps.getMainWindow()?.webContents.send(IpcChannel.notificationsChanged);
  }
}

/**
 * The main window when it is genuinely on screen — shown, not minimized, not
 * torn down. This is the whole gate on the NTF-008 ask: a modal question pushed
 * to a hidden or minimized window would be answered by nobody while the
 * reminder it is holding sits undelivered, so "can this be seen right now" is
 * the condition, not "does a window object exist".
 */
function visibleMainWindow(deps: NotificationSchedulerDeps): BrowserWindow | null {
  const win = deps.getMainWindow();
  if (!win || win.isDestroyed()) return null;
  return win.isVisible() && !win.isMinimized() ? win : null;
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
 * Delivers the security events that have actually happened on this device
 * (NTF-007): records each one in every profile's ledger and puts it in front of
 * the user, with no quiet-hours or appetite gate anywhere in the path — that is
 * the whole point of `ALWAYS_ON_SOURCES`, and it is why these never travel
 * through `deriveNotificationCandidates`, which only knows how to re-derive
 * standing state.
 *
 * **Every profile, one toast.** A wrong-passcode burst or a passcode change is a
 * fact about the ACCOUNT, not about one profile inside it, so each profile's
 * center gets its own row — the same reasoning the scheduler's own
 * profile loop already runs on. The OS toast fires once per event regardless:
 * the user is one person.
 *
 * **Never throws.** It is called on the unlock path, and an unlock that
 * succeeded must not fail because a notification could not be written. A row
 * that cannot be recorded (a ledger collision, a profile that vanished) is
 * logged and the toast still fires — the user being told is what matters, the
 * ledger row is the receipt.
 */
export function deliverSecurityNotices(
  deps: SecurityNotificationDeps,
  notices: readonly SecurityNotice[],
): void {
  if (notices.length === 0) return;

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const items = notices.map((notice) => ({
    source: "security" as const,
    copy: securityNotificationCopy(notice),
    notice,
  }));

  let profiles: ReadonlyArray<{ id: string }> = [];
  try {
    profiles = deps.listProfiles();
  } catch (error) {
    logSecurityFailure(error);
  }

  let recorded = false;
  for (const profile of profiles) {
    for (const item of items) {
      try {
        deps.notificationStore(profile.id).recordDelivered(
          {
            source: "security",
            // The kind is the entity — there is no row anywhere to point at —
            // and the instant is what tells two events of one kind apart.
            entityId: item.notice.kind,
            occurrenceKey: item.notice.at,
            title: item.copy.title,
            body: item.copy.body,
          },
          nowIso,
        );
        recorded = true;
      } catch (error) {
        logSecurityFailure(error);
      }
    }
  }

  // Each notice gets its own toast, always: `coalesceDeliveries` exempts an
  // always-on source from the digest and from the window entirely, so a
  // security notice is never folded into a count of other things and never
  // silences the reminder stream around it (NTF-007 / NTF-009).
  showNotifications(deps, items, { now: nowMs, launch: false });
  if (recorded) {
    deps.getMainWindow()?.webContents.send(IpcChannel.notificationsChanged);
  }
}

function logSecurityFailure(error: unknown): void {
  console.error(
    `Security notification could not be recorded (it was still shown): ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
}

/**
 * Puts one check's batch in front of the user, under `coalesceDeliveries`'s
 * rules (NTF-009): individually while the batch is small and nothing else has
 * interrupted recently, otherwise as one digest — the count guard for an
 * oversized single pass, the rolling window for several arriving back to back,
 * and the catch-up wording for the first pass after unlock, which is the one
 * pass whose pile is all things that came due while the app was closed.
 *
 * **The ledger is untouched by any of this.** Every occurrence here was already
 * recorded individually before this function was called, so the notification
 * center shows all of them whatever the OS was asked to display: the ledger is
 * truth, the toast is politeness. Guards `Notification.isSupported()` once for
 * the whole batch.
 */
function showNotifications(
  deps: Pick<NotificationSchedulerDeps, "getMainWindow">,
  items: readonly ToastItem[],
  moment: { now: number; launch: boolean },
): void {
  if (items.length === 0 || !Notification.isSupported()) return;

  const result = coalesceDeliveries({ arrivals: items, now: moment.now, window: deliveryWindow });
  deliveryWindow = result.window;

  for (const item of result.individual) showOne(deps, item.copy);
  if (result.digest === null) return;

  const counts = emptyDigestCounts();
  for (const item of result.digest) {
    // Unreachable — `coalesceDeliveries` never folds an always-on source — and
    // spelled out anyway, because it is the one line that makes the counter's
    // narrower domain (`DigestCounts`) provable rather than merely intended.
    if (item.source === "security") continue;
    counts[item.source] += 1;
  }
  const total = result.digest.length;
  showOne(
    deps,
    moment.launch
      ? catchUpDigestCopy(total, counts)
      : result.reason === "window"
        ? windowDigestCopy(total, counts)
        : groupedDigestCopy(total, counts),
  );
}

function showOne(deps: Pick<NotificationSchedulerDeps, "getMainWindow">, copy: NotificationCopy): void {
  const notification = new Notification({ title: copy.title, body: copy.body });
  notification.on("click", () => {
    const win = deps.getMainWindow();
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  notification.show();
}
