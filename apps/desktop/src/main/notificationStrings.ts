import type { NotificationSource } from "@nexus/core";

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

/** Per-source counts for a digest, in the fixed order documents/exams/study-days/events/tasks. */
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
  return { document: 0, exam: 0, "study-day": 0, event: 0, task: 0 };
}
