/**
 * The five task smart lists (ADR-049) — Danas, Sledećih 7 dana, Hitno, Kasni and
 * Završeno.
 *
 * They are QUERIES, never copies: nothing here writes, nothing here has a
 * `list_id`, and a task appears in a smart list only for as long as its own
 * fields keep it there. That is the whole reason the module is pure — the rail
 * renders the same array the page already loaded, filtered and ordered here, so
 * there is no second source of truth to drift.
 *
 * Two things this module deliberately does NOT do:
 *
 *   - It does not read a clock. "Today" arrives as a bare `YYYY-MM-DD` local day
 *     key, exactly as `resolveDueRange` takes one, so the same rules can be
 *     tested against any day and the renderer stays the one place that decides
 *     what day it is.
 *   - It does not derive blocked-ness. A task is blocked when a live dependency
 *     of it is still open (ADR-037) — derived from the edge list, never a column
 *     — so the caller hands in a predicate over ids rather than a field this
 *     shape would have to carry.
 */

import { shiftDayKey } from "../calendar/calendarGrid.js";
import { SEARCH_DUE_WEEK_DAYS } from "../search/searchOperators.js";

/** The five lists, in the order the rail draws them. */
export const SMART_LIST_IDS = ["danas", "sledecih7", "hitno", "kasni", "zavrseno"] as const;

export type SmartListId = (typeof SMART_LIST_IDS)[number];

/** Task priorities, most urgent last — the store's own order (`TASK_PRIORITIES`). */
type SmartListPriority = "none" | "low" | "medium" | "high";

/**
 * The fields a smart list reads, and no more. Structural on purpose: the
 * renderer's `Task` (and anything wrapping it) satisfies this without this
 * package knowing the wire contract exists.
 */
export interface SmartListTask {
  readonly id: string;
  readonly done: boolean;
  /** Bare `YYYY-MM-DD` or a full instant; only its day part is ever compared. */
  readonly dueDate: string | null;
  /** The day the task becomes actionable, or null when it always is. */
  readonly startDate: string | null;
  readonly priority: SmartListPriority;
  readonly createdAt: string;
  /** Non-null exactly when `done` — the store's own CHECK. */
  readonly completedAt: string | null;
}

export interface SmartListContext {
  /** The local calendar day, as a bare `YYYY-MM-DD` key. */
  readonly today: string;
  /** Whether a task is waiting on something still open (ADR-037), by id. */
  readonly isBlocked: (taskId: string) => boolean;
  /** Whether Danas and Sledećih 7 dana show blocked tasks; the device preference behind it defaults to excluding them. */
  readonly includeBlocked: boolean;
}

/** Rank for the priority sort — higher is more urgent, so a plain descending compare reads as "high first". */
const PRIORITY_RANK: Readonly<Record<SmartListPriority, number>> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
};

/**
 * The day a date field falls on. Day keys are zero-padded ISO, so a lexical
 * compare of two of these IS a date compare — which is why nothing below parses
 * a `Date`.
 */
function dayOf(value: string | null): string | null {
  return value === null ? null : value.slice(0, 10);
}

/** Whether the task has not become actionable yet — its start day is still ahead of today. */
function notStarted(task: SmartListTask, today: string): boolean {
  const start = dayOf(task.startDate);
  return start !== null && start > today;
}

/** Whether a not-yet-actionable or waiting task is allowed into the two "what now" lists. */
function readyNow(task: SmartListTask, context: SmartListContext): boolean {
  if (notStarted(task, context.today)) return false;
  return context.includeBlocked || !context.isBlocked(task.id);
}

/** Locale-free string order — the tie-breaker every list ends in, so an ordering is reproducible rather than collation-dependent. */
function compareRaw(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Rok ascending with the UNDATED LAST: a task with no deadline is not "earliest", it is simply not on the calendar. */
function compareDue(a: SmartListTask, b: SmartListTask): number {
  const left = dayOf(a.dueDate);
  const right = dayOf(b.dueDate);
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return compareRaw(left, right);
}

/** Most urgent first. */
function comparePriority(a: SmartListTask, b: SmartListTask): number {
  return PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority];
}

/** Oldest first — among equals, the task that has been waiting longest leads. */
function compareAge(a: SmartListTask, b: SmartListTask): number {
  return compareRaw(a.createdAt, b.createdAt);
}

/** Whether one task belongs in one smart list. */
export function matchesSmartList(
  task: SmartListTask,
  listId: SmartListId,
  context: SmartListContext,
): boolean {
  if (listId === "zavrseno") return task.done;
  if (task.done) return false;

  const due = dayOf(task.dueDate);
  switch (listId) {
    case "danas":
      return due === context.today && readyNow(task, context);
    case "sledecih7":
      // The same span the search „nedelja“ operator means (today plus the next
      // six): one word, one meaning, wherever the app says "a week".
      return (
        due !== null &&
        due >= context.today &&
        due <= shiftDayKey(context.today, SEARCH_DUE_WEEK_DAYS - 1) &&
        readyNow(task, context)
      );
    case "hitno":
      // High ONLY — the single priority a row already renders as an accent chip.
      // Widening it to "medium and up" would make the list say something the
      // rows themselves do not.
      return task.priority === "high";
    case "kasni":
      // Disjoint from Danas by construction: strictly before today. A stale
      // recurring task appears here once, at the rok it has not advanced past.
      return due !== null && due < context.today;
  }
}

/** The order one smart list puts two of its own rows in. */
export function compareSmartListTasks(
  a: SmartListTask,
  b: SmartListTask,
  listId: SmartListId,
): number {
  switch (listId) {
    case "danas":
      // Every row shares one rok, so priority is what is left to say.
      return comparePriority(a, b) || compareAge(a, b) || compareRaw(a.id, b.id);
    case "sledecih7":
      // A week of rows: the day leads, and priority orders within a day.
      return compareDue(a, b) || comparePriority(a, b) || compareAge(a, b) || compareRaw(a.id, b.id);
    case "hitno":
      // Every row is already high, so the deadline is the only ranking left.
      return compareDue(a, b) || compareAge(a, b) || compareRaw(a.id, b.id);
    case "kasni":
      // Longest overdue first — the row that has been waiting most.
      return compareDue(a, b) || compareRaw(a.id, b.id);
    case "zavrseno":
      // Most recently finished first; `completedAt` is non-null on every row a
      // done-only filter can produce, and the null branches only keep the
      // compare total.
      return compareCompletedDesc(a, b) || compareRaw(a.id, b.id);
  }
}

/** Completion instant descending, with a (contract-impossible) null last. */
function compareCompletedDesc(a: SmartListTask, b: SmartListTask): number {
  if (a.completedAt === null && b.completedAt === null) return 0;
  if (a.completedAt === null) return 1;
  if (b.completedAt === null) return -1;
  return compareRaw(b.completedAt, a.completedAt);
}

/**
 * The rows of one smart list, in its own order — a new array, so the caller's
 * own is never reordered under it. Generic over the caller's row type, so a
 * page keeps its full tasks rather than the minimal shape this module reads.
 */
export function selectSmartList<T extends SmartListTask>(
  tasks: readonly T[],
  listId: SmartListId,
  context: SmartListContext,
): T[] {
  return tasks
    .filter((task) => matchesSmartList(task, listId, context))
    .sort((a, b) => compareSmartListTasks(a, b, listId));
}

/**
 * How many days a finished task stays under „Završeno“ before the view files it
 * in the archive beneath. Chosen, not sacred: a month reads as "recently done"
 * without becoming another preference to tune.
 */
export const TASK_ARCHIVE_AFTER_DAYS = 30;

/**
 * „Završeno“, parted at the archive boundary — the same predicate and the same
 * ordering as `selectSmartList(…, "zavrseno", …)`, split into the tasks
 * completed within the last `TASK_ARCHIVE_AFTER_DAYS` days (`recent`) and
 * everything older (`archived`). NOT a sixth list: counts, search and batch
 * selection keep meaning "completed at all", and this is only how the one view
 * draws itself — recent rows in the open, archived ones behind a disclosure.
 *
 * The boundary day is INCLUSIVE on the recent side: a task completed exactly
 * `TASK_ARCHIVE_AFTER_DAYS` days ago is still recent, so `today − 30` is the
 * oldest recent day and only strictly older days archive. Only day keys are
 * compared (the module's own `dayOf`, never a parsed `Date`), so a task ages
 * out at midnight, whole days at a time.
 */
export function splitZavrseno<T extends SmartListTask>(
  tasks: readonly T[],
  context: SmartListContext,
): { recent: T[]; archived: T[] } {
  const oldestRecentDay = shiftDayKey(context.today, -TASK_ARCHIVE_AFTER_DAYS);
  const recent: T[] = [];
  const archived: T[] = [];
  for (const row of selectSmartList(tasks, "zavrseno", context)) {
    // A null completion day cannot leave the store (`completedAt` is non-null
    // exactly when `done`); it falls to `archived` only to keep the split total,
    // matching the ordering's own null-last branch.
    const day = dayOf(row.completedAt);
    (day !== null && day >= oldestRecentDay ? recent : archived).push(row);
  }
  return { recent, archived };
}
