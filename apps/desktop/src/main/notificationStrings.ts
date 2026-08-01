import type { FocusPhaseKind, HabitSchedule, NotificationSource } from "@nexus/core";

/**
 * Serbian copy for OS notifications, fired only from the main process (NTF
 * piece a2). The main process cannot import the renderer's `strings.ts` — a
 * separate bundle, browser-only build — so this is the single, centralized
 * main-side counterpart. It produces exactly the text snapshot recorded by
 * `NotificationStore.recordDelivered` and shown by an OS `Notification`; the
 * later bell/center UI (NTF piece a3) keeps using the renderer's own
 * `strings.ts` for everything it renders itself. Sentence case throughout, no
 * exclamation marks (the app's tone: informative, never alarming).
 */

/** One notification's exact text snapshot. */
export interface NotificationCopy {
  title: string;
  body: string;
}

const EXAM_TYPE_LABELS: Record<"pismeni" | "usmeni" | "kolokvijum", string> = {
  pismeni: "Pismeni",
  usmeni: "Usmeni",
  kolokvijum: "Kolokvijum",
};

const MS_PER_DAY = 86_400_000;
const MINUTES_PER_DAY = 1_440;
const MINUTES_PER_HOUR = 60;

/** UTC-midnight ms for a bare "YYYY-MM-DD" prefix (mirrors the engine's own `utcDayMs`). */
function utcDayMs(dateKey: string): number {
  const [yearPart, monthPart, dayPart] = dateKey.slice(0, 10).split("-");
  return Date.UTC(Number(yearPart), Number(monthPart) - 1, Number(dayPart));
}

/** Whole days from `today` to `dateKey` (both bare "YYYY-MM-DD"). */
function daysUntil(today: string, dateKey: string): number {
  return Math.round((utcDayMs(dateKey) - utcDayMs(today)) / MS_PER_DAY);
}

/** "YYYY-MM-DD" -> "DD.MM.YYYY." (Serbian date punctuation). */
function formatDate(dateKey: string): string {
  const [year, month, day] = dateKey.slice(0, 10).split("-");
  return `${day}.${month}.${year}.`;
}

/**
 * An ISO-8601 instant as local wall-clock "DD.MM.YYYY. u HH:MM" — the same
 * punctuation `formatDate` uses, extended to the minute. Assembled from the
 * `Date`'s own local fields rather than through `Intl`, so the shape is fixed
 * whatever the host is set to; an unparseable string is returned unchanged
 * (mirrors the renderer's `formatNotificationWhen`), because a security notice
 * with an odd timestamp in it is still worth showing.
 */
function formatInstant(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (value: number): string => String(value).padStart(2, "0");
  const dateKey = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `${formatDate(dateKey)} u ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Serbian 1 / 2-4 / 5+ numeral agreement. The renderer's `strings.ts` has a
 * simpler 2-way `dayUnit` (singular vs. "many") that happens to be correct
 * for "dan/dana" because that word's paucal and plural forms coincide; other
 * nouns here (documents, reminders) do not coincide, so this is the full
 * 3-way rule. Main and renderer never share a module, so this is kept in
 * sync with `dayUnit`'s singular rule by hand, not by import.
 */
function pluralize(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/** "dan"/"dana" agreement — the renderer's `dayUnit` rule, reused verbatim (the two forms coincide for this word). */
function dayUnit(count: number): string {
  return count % 10 === 1 && count % 100 !== 11 ? "dan" : "dana";
}

/**
 * Document expiry reminder copy. `today`/`expiryDate` are bare "YYYY-MM-DD".
 * `isFinalWarning` is the candidate's `priority === "max"` — the ladder's
 * smallest offset, the PRD's quiet-hours exception — and gets its own title.
 */
export function documentNotificationCopy(
  label: string,
  expiryDate: string,
  today: string,
  isFinalWarning: boolean,
): NotificationCopy {
  const title = isFinalWarning ? "Poslednja opomena: dokument ističe" : "Dokument uskoro ističe";
  const days = daysUntil(today, expiryDate);
  const dayPhrase = days <= 0 ? "ističe danas" : `ističe za ${days} ${dayUnit(days)}`;
  return { title, body: `„${label}“ ${dayPhrase} (${formatDate(expiryDate)})` };
}

/** Exam reminder copy: day-before ("d-1") vs. morning-of ("d-0"). */
export function examNotificationCopy(
  subjectName: string,
  examType: "pismeni" | "usmeni" | "kolokvijum",
  occurrenceKey: "d-1" | "d-0",
): NotificationCopy {
  const title = occurrenceKey === "d-0" ? "Ispit je danas" : "Ispit sutra";
  return { title, body: `${subjectName} — ${EXAM_TYPE_LABELS[examType]}` };
}

/**
 * A non-zero lead time as the user set it: "10 min ranije", "1 h ranije",
 * "2 dana ranije". Whole days and whole hours get their own unit so a day-long
 * lead never reads as "1440 min". The renderer's event form spells the very
 * same ladder for its chips — kept in sync by hand, like `dayUnit` above, since
 * main and renderer never share a module.
 */
function leadPhrase(offsetMinutes: number): string {
  if (offsetMinutes % MINUTES_PER_DAY === 0) return dayLeadPhrase(offsetMinutes / MINUTES_PER_DAY);
  if (offsetMinutes % MINUTES_PER_HOUR === 0) {
    return `${offsetMinutes / MINUTES_PER_HOUR} h ranije`;
  }
  return `${offsetMinutes} min ranije`;
}

/**
 * A lead time already counted in whole days: "3 dana ranije". `leadPhrase`
 * above is minutes-based (an event's ladder), so its day branch delegates here
 * rather than the two spelling the same phrase twice — a task's ladder
 * (ADR-028) is in days to begin with and has no minutes to divide down.
 */
function dayLeadPhrase(days: number): string {
  return `${days} ${dayUnit(days)} ranije`;
}

/**
 * Event reminder copy (CAL-006). `occurrenceDate`/`today` are bare
 * "YYYY-MM-DD" — for a recurring series that is the occurrence's own day, not
 * the master's — and `startTime` is its "HH:MM" wall-clock start, or null for
 * an all-day event.
 *
 * The body states when the event actually starts rather than how long is left:
 * a reminder that came due while the app was closed surfaces on the next check,
 * so anything phrased as a countdown would be a lie exactly when it matters.
 * The lead time is still named — it is what the user set, and it is what tells
 * two reminders for the SAME occurrence apart — but only for a timed one: an
 * all-day occurrence's sub-day offsets all collapse onto its own morning
 * (see the engine), so "10 min ranije" there would describe nothing.
 */
export function eventNotificationCopy(
  title: string,
  occurrenceDate: string,
  today: string,
  startTime: string | null,
  offsetMinutes: number,
): NotificationCopy {
  const days = daysUntil(today, occurrenceDate);
  const dayPhrase = days === 0 ? "danas" : days === 1 ? "sutra" : formatDate(occurrenceDate);

  if (startTime === null) {
    return { title: `Događaj: ${title}`, body: `Ceo dan · ${dayPhrase}` };
  }
  const startPhrase = days === 0 ? `Počinje u ${startTime}` : `Počinje ${dayPhrase} u ${startTime}`;
  return {
    title: `Događaj: ${title}`,
    body: offsetMinutes > 0 ? `${startPhrase} · ${leadPhrase(offsetMinutes)}` : startPhrase,
  };
}

/**
 * Task reminder copy (ADR-028). `dueDate`/`today` are bare "YYYY-MM-DD" and
 * `offsetDays` is the whole-day lead time that produced this occurrence.
 *
 * Like the event copy, the body states WHEN the task is due rather than how
 * long is left: a reminder that came due while the app was closed surfaces on
 * the next check, so a countdown would be a lie exactly when it matters. The
 * lead time is still named — it is what the user set, and it is what tells two
 * reminders for the same due date apart — but only when it is non-zero: "0 dana
 * ranije" on the day itself would describe nothing.
 */
export function taskNotificationCopy(
  title: string,
  dueDate: string,
  today: string,
  offsetDays: number,
): NotificationCopy {
  const days = daysUntil(today, dueDate);
  const duePhrase =
    days === 0 ? "Rok je danas" : days === 1 ? "Rok je sutra" : `Rok: ${formatDate(dueDate)}`;
  return {
    title: `Zadatak: ${title}`,
    body: offsetDays > 0 ? `${duePhrase} · ${dayLeadPhrase(offsetDays)}` : duePhrase,
  };
}

/**
 * Subscription renewal copy (FIN slice d). `renewalDate`/`today` are bare
 * "YYYY-MM-DD" and `reminderDays` is the whole-day lead that produced this
 * occurrence; `amount` is minor units, negative for money going out.
 *
 * The body states WHEN the charge falls and HOW MUCH, for the reason the task
 * copy states the due date: a reminder that came due while the app was closed
 * surfaces on the next check, so a countdown would be a lie exactly when it
 * matters. The amount is what makes this notification worth having at all —
 * „Netflix se obnavlja" says nothing a calendar could not, while the figure is
 * the thing a person actually wants a heads-up about.
 *
 * Money is formatted HERE and nowhere else in main: two decimals, comma
 * separator (Serbian), and the currency code after it — the display edge's job,
 * done at the display edge, exactly as `money.ts` does it in the renderer. The
 * minor-unit integer is never divided anywhere else.
 */
export function subscriptionNotificationCopy(
  name: string,
  renewalDate: string,
  today: string,
  amount: number,
  currency: string,
  reminderDays: number,
): NotificationCopy {
  const days = daysUntil(today, renewalDate);
  const whenPhrase =
    days === 0
      ? "Naplata je danas"
      : days === 1
        ? "Naplata je sutra"
        : `Naplata: ${formatDate(renewalDate)}`;
  const parts = [whenPhrase, `${formatMinorUnits(amount)} ${currency}`];
  if (reminderDays > 0) parts.push(dayLeadPhrase(reminderDays));
  return { title: `Pretplata: ${name}`, body: parts.join(" · ") };
}

/**
 * Minor units as a Serbian decimal: 1190 → „11,90". The sign is dropped because
 * the sentence already says this is a naplata — a leading minus would read as an
 * error rather than as direction. Integer arithmetic throughout: the whole and
 * the fractional part are split with `Math.trunc`/`%`, never by dividing.
 */
function formatMinorUnits(amount: number): string {
  const absolute = Math.abs(amount);
  const whole = Math.trunc(absolute / 100);
  const cents = absolute % 100;
  return `${whole},${String(cents).padStart(2, "0")}`;
}

/**
 * One security-relevant event that actually happened on this device (NTF-007),
 * as main hands it to the notification path. `at` is the instant it happened —
 * main's own clock, never the renderer's — and doubles as the occurrence key
 * that keeps two events of the same kind apart in the ledger.
 *
 * Only the four events that genuinely occur locally are modelled: the unlock
 * throttle tripping, a passcode change, a Recovery Kit reissue, and another
 * account being deleted from this device. Each carries exactly the facts its
 * copy needs and nothing else — in particular the deleted account's label is
 * passed through in memory rather than persisted anywhere, since the account it
 * names is being erased in the same breath.
 */
export type SecurityNotice = { at: string } & (
  | {
      kind: "unlock-throttle";
      /** Wrong attempts accumulated before the unlock that cleared them. */
      failedAttempts: number;
      /** ISO-8601 instant the throttle's last wait ran to — the one time fact that survives the trip. */
      lockedUntil: string;
    }
  | { kind: "passcode-changed" }
  | { kind: "recovery-kit-reissued" }
  | { kind: "account-deleted"; label: string }
);

/**
 * Serbian copy for one security notice. Same tone as every other notification
 * here — sentence case, informative, no exclamation marks — because alarm is
 * not information: the title states what happened, the body states the one
 * consequence that follows from it.
 *
 * The throttle notice is the only one that names a time, and deliberately so:
 * it is the only one that can be DELIVERED long after it happened (the database
 * was locked when it tripped — that is what tripping means), so "when" is not
 * something the row's own delivery timestamp can answer.
 */
export function securityNotificationCopy(notice: SecurityNotice): NotificationCopy {
  switch (notice.kind) {
    case "unlock-throttle": {
      const attempts = notice.failedAttempts;
      const unit = pluralize(attempts, "pogrešan pokušaj", "pogrešna pokušaja", "pogrešnih pokušaja");
      return {
        title: "Više pogrešnih pokušaja otključavanja",
        body: `${attempts} ${unit} pre ovog otključavanja · zaključavanje do ${formatInstant(notice.lockedUntil)}`,
      };
    }
    case "passcode-changed":
      return { title: "PIN je promenjen", body: "Otključavanje sada traži novi PIN." };
    case "recovery-kit-reissued":
      return { title: "Izdat je novi Recovery Kit", body: "Stari kod više ne važi." };
    case "account-deleted":
      return {
        title: "Nalog je obrisan",
        body: `Nalog „${notice.label}“ je obrisan sa ovog uređaja.`,
      };
  }
}

/**
 * Habit reminder copy (HABIT slice c). Fires at the hour its owner picked, on a
 * day the schedule expects, and only while the habit is NOT yet done — every one
 * of those is decided upstream (`habitReminderInputs`), so this text can say the
 * one thing it is always entitled to say: what is left to do.
 *
 * The body is what the habit ASKS FOR, and nothing else. No streak („niz: 12"
 * would turn a nudge into something to lose), no progress figure („3/8" reads as
 * a scoreboard on a reminder), no encouragement — the app's tone is informative,
 * and a habit tracker that cheers is a habit tracker people mute. A binary habit
 * has nothing to state beyond the schedule; a measured one states its target,
 * because „8 čaša" is the actual ask and „uradi ovo" is not.
 *
 * The schedule reading is the page's own, restated here rather than imported:
 * main cannot reach the renderer's `strings.ts` (see this file's header), which
 * is exactly why this module exists.
 */
export function habitNotificationCopy(
  name: string,
  schedule: HabitSchedule,
  target: number | null,
  unit: string | null,
): NotificationCopy {
  const parts = [habitScheduleLabel(schedule)];
  if (target !== null) parts.push(`cilj: ${target}${unit === null ? "" : ` ${unit}`}`);
  return { title: `Navika: ${name}`, body: parts.join(" · ") };
}

/** Short weekday names in ISO order (1 = ponedeljak) — mirrors `strings.habits.schedule.weekdayShort`. */
const HABIT_WEEKDAY_SHORT = ["Pon", "Uto", "Sre", "Čet", "Pet", "Sub", "Ned"] as const;

/** A habit's schedule in words — „Svaki dan", „Pon · Sre · Pet", „3× nedeljno". */
function habitScheduleLabel(schedule: HabitSchedule): string {
  if (schedule.kind === "quota") return `${schedule.perWeek}× nedeljno`;
  if (schedule.weekdays.length === HABIT_WEEKDAY_SHORT.length) return "Svaki dan";
  return schedule.weekdays.map((iso) => HABIT_WEEKDAY_SHORT[iso - 1] ?? "").join(" · ");
}

/** What each phase kind is called when its planned end arrives — the module's own three words. */
const FOCUS_PHASE_TITLES: Record<FocusPhaseKind, string> = {
  work: "Fokus je gotov",
  short_break: "Pauza je gotova",
  long_break: "Duga pauza je gotova",
};

/**
 * A focus phase has reached its planned end (UTIL slice b, ADR-077).
 *
 * **This copy is deliberately NOT part of the NTF ledger**, and the reason is
 * structural rather than an omission. Everything else in this file describes a
 * SCHEDULED reminder: something that must survive the app being closed, must be
 * caught up on at the next unlock, and must not fire twice — which is what the
 * `notifications` table, its `source` CHECK and its UNIQUE tuple exist to
 * guarantee. A phase ending is none of that: it is an immediate event of a timer
 * that only runs while this process runs, so there is no closed-app window to be
 * missed in, no catch-up pass to belong to and no duplicate to guard against.
 * Widening the source CHECKs to admit it would be a migration bought for
 * nothing, and it would put a row in the notification centre whose „snooze" and
 * „dismiss" could not mean anything.
 *
 * The body names what the phase WAS — its length, and the subject or task it
 * carried — and says nothing about what to do next. What follows is `nextPhase`'s
 * answer and the page's offer; a notification that told the user to take a break
 * would be deciding for them from behind a toast.
 */
export function focusPhaseEndCopy(
  kind: FocusPhaseKind,
  plannedMinutes: number,
  label: string | null,
): NotificationCopy {
  const parts = [`${plannedMinutes} min`];
  if (label !== null && label.trim().length > 0) parts.push(label.trim());
  return { title: FOCUS_PHASE_TITLES[kind], body: parts.join(" · ") };
}

/** Today's study-day reminder copy: how many blocks are planned and their total length. */
export function studyDayNotificationCopy(blockCount: number, totalMinutes: number): NotificationCopy {
  const blockPhrase = pluralize(blockCount, "blok", "bloka", "blokova");
  return { title: "Učenje danas", body: `${blockCount} ${blockPhrase} · ${totalMinutes} min` };
}

/**
 * The sources a digest can count: every one but the always-on `"security"`,
 * which is never folded into a digest at all (NTF-009 — see
 * `coalesceDeliveries`). Spelled as an `Exclude` rather than a hand-written
 * list so a source added to `@nexus/core` lands here for free, and so the
 * exemption stays a single rule rather than a convention repeated in two files.
 */
export type FoldableNotificationSource = Exclude<NotificationSource, "security">;

/** Per-source counts for a digest, in the fixed order documents/exams/study-days/events/tasks/subscriptions/habits. */
export type DigestCounts = Record<FoldableNotificationSource, number>;

/**
 * The shared body of every digest: each contributing source's count under its
 * own Serbian noun, in the fixed order above, middle-dot separated. A source
 * with no deliveries is omitted rather than printed as a zero.
 */
function digestBody(counts: DigestCounts): string {
  const parts: string[] = [];
  if (counts.document > 0) {
    parts.push(`${counts.document} ${pluralize(counts.document, "dokument", "dokumenta", "dokumenata")}`);
  }
  if (counts.exam > 0) {
    parts.push(`${counts.exam} ${pluralize(counts.exam, "ispit", "ispita", "ispita")}`);
  }
  if (counts["study-day"] > 0) {
    parts.push(`${counts["study-day"]} ${pluralize(counts["study-day"], "učenje", "učenja", "učenja")}`);
  }
  if (counts.event > 0) {
    parts.push(`${counts.event} ${pluralize(counts.event, "događaj", "događaja", "događaja")}`);
  }
  if (counts.task > 0) {
    parts.push(`${counts.task} ${pluralize(counts.task, "zadatak", "zadatka", "zadataka")}`);
  }
  if (counts.subscription > 0) {
    parts.push(
      `${counts.subscription} ${pluralize(counts.subscription, "pretplata", "pretplate", "pretplata")}`,
    );
  }
  if (counts.habit > 0) {
    parts.push(`${counts.habit} ${pluralize(counts.habit, "navika", "navike", "navika")}`);
  }
  return parts.join(" · ");
}

/**
 * Grouped-digest copy for a batch of more than `DIGEST_COUNT_THRESHOLD`
 * simultaneous notifications (the storm guard): one title with the total, one
 * body listing each contributing source's count. The app names itself here
 * because this toast replaces several that would each have said what they were
 * about — the only place in the notification copy where „Nexus“ appears.
 */
export function groupedDigestCopy(total: number, counts: DigestCounts): NotificationCopy {
  return {
    title: `Nexus — ${total} ${pluralize(total, "podsetnik", "podsetnika", "podsetnika")}`,
    body: digestBody(counts),
  };
}

/**
 * Digest copy for the rolling-window collapse (NTF-009): notifications that
 * landed within `COALESCE_WINDOW_MS` of the previous toast, summarized as one
 * running count of everything the live window has delivered. „Novo“ rather than
 * „podsetnik“ because a window digest can supersede toasts the user has already
 * seen — it states how many new things are waiting, not how many times the app
 * is asking.
 */
export function windowDigestCopy(total: number, counts: DigestCounts): NotificationCopy {
  return {
    title: `${total} ${pluralize(total, "novo obaveštenje", "nova obaveštenja", "novih obaveštenja")}`,
    body: digestBody(counts),
  };
}

/**
 * Digest copy for the first scheduler pass after unlock (PRD 05 §5): everything
 * that came due while the app was closed surfaces at once, and saying so is
 * what makes a pile of reminders read as a catch-up rather than as the app
 * suddenly shouting. Same body as every other digest — what piled up is exactly
 * the per-source breakdown.
 */
export function catchUpDigestCopy(total: number, counts: DigestCounts): NotificationCopy {
  return {
    title: `Dok te nije bilo: ${total} ${pluralize(total, "obaveštenje", "obaveštenja", "obaveštenja")}`,
    body: digestBody(counts),
  };
}

/**
 * An empty per-source counter, keyed the same way as `@nexus/core`'s
 * `NotificationSource` minus the always-on one. There is no security count
 * because a security notice never reaches a digest: `coalesceDeliveries` gives
 * it its own toast, always (NTF-007 / NTF-009).
 */
export function emptyDigestCounts(): DigestCounts {
  return { document: 0, exam: 0, "study-day": 0, event: 0, task: 0, subscription: 0, habit: 0 };
}
