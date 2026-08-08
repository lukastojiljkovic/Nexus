import { matchesSmartList } from "@nexus/core";
import type { SmartListContext, SmartListTask } from "@nexus/core";
import { focusSessionMinutes } from "./focusFormat.js";

/**
 * The dashboard's summary band — the pure half.
 *
 * The board answers „what is on my list" nine cards at a time and never
 * answered „how am I doing" at all, which is the question somebody actually
 * arrives with. The band over the grid answers it in four figures, and this
 * module is the arithmetic behind them: a function of an explicit reading of
 * the day and of data the page has genuinely loaded, never of `Date.now()` and
 * never of anything a card fetched (ADR-045 section 4 — the page holds no
 * widget data, and reaching into a card's read to feed the header is the very
 * coupling that boundary exists to prevent). It lives here rather than in
 * `DashboardPage.tsx` for `dashboardStrip.ts`'s reason: Vitest runs without a
 * DOM, so a helper that takes arrays and answers with counts is testable and a
 * React component is not.
 *
 * **A figure whose module is switched off is `null`, never `0`.** „0 događaja
 * danas" is a claim about an empty calendar; a calendar that is not installed
 * has made no such claim, and the two must not be drawn the same. That is why
 * every input is nullable — the page passes `null` for a module it did not
 * read, and the null travels all the way through to a figure the band leaves
 * out.
 *
 * **Nothing here estimates.** Every count is a filter over rows that were
 * actually read, run through the very predicates the owning module's views run
 * (`matchesSmartList`, ADR-049) so a figure and the card under it can never
 * disagree about what „danas" or „kasni" means.
 */

/**
 * What the event count reads off the merged calendar stream. Structural on
 * purpose, exactly as `SmartListTask` is: `CalendarItem` satisfies it without
 * this module importing the merge, and a test can hand it three object
 * literals.
 */
export interface SummaryCalendarItem {
  /** The merge's discriminator; only `"event"` is counted. */
  readonly kind: string;
  /** Bare `YYYY-MM-DD` day the item starts on. */
  readonly startKey: string;
  /** Bare `YYYY-MM-DD` day it ends on — equal to `startKey` for a single-day item. */
  readonly endKey: string;
}

/** A finished focus session, in the shape `focusSessionMinutes` reads. */
export interface SummaryFocusSession {
  readonly startedAt: string;
  readonly endedAt: string;
  readonly pausedSeconds: number;
}

export interface DashboardSummaryInput {
  /**
   * Today's merged calendar stream, or `null` when CAL is off. Non-recurring
   * rows flow through `buildCalendarItems` untouched however far outside its
   * range they fall, so the day filter below — not the range the merge was
   * asked for — is what makes this figure about today.
   */
  readonly items: readonly SummaryCalendarItem[] | null;
  /** The local calendar day, as a bare `YYYY-MM-DD` key. */
  readonly todayKey: string;
  /** The profile's tasks, or `null` when TASK is off. */
  readonly tasks: readonly SmartListTask[] | null;
  /** Today's recorded focus sessions, or `null` when neither owning module is on. */
  readonly focusSessions: readonly SummaryFocusSession[] | null;
}

/** The four figures, each `null` exactly when its module is off. */
export interface DashboardSummary {
  /** Events covering today — a multi-day span counts on every day it covers. */
  readonly eventsToday: number | null;
  /** Tasks whose rok is today and that are actionable — TASK's „Danas" list, counted. */
  readonly tasksToday: number | null;
  /** Tasks whose rok is already past — TASK's „Kasni" list, counted. */
  readonly tasksLate: number | null;
  /**
   * Whole minutes of ATTENTION recorded today. A LOWER BOUND while a phase is
   * running: the engine writes a session only when one is stopped, so what a
   * timer is earning right now is in no row yet. The page knows whether one
   * runs and says so beside the figure; this module only counts what exists.
   */
  readonly focusMinutes: number | null;
}

/**
 * The same posture every dashboard card takes (ADR-037): the page reads the
 * task list alone and never the dependency edges, so it has no honest way to
 * tell a blocked task from a free one — and stating a rule it cannot apply
 * would be worse than counting every task due today.
 */
function summaryContext(todayKey: string): SmartListContext {
  return { today: todayKey, isBlocked: () => false, includeBlocked: true };
}

export function dashboardSummary(input: DashboardSummaryInput): DashboardSummary {
  const context = summaryContext(input.todayKey);
  const countTasks = (listId: "danas" | "kasni"): number | null =>
    input.tasks === null
      ? null
      : input.tasks.filter((task) => matchesSmartList(task, listId, context)).length;

  return {
    eventsToday:
      input.items === null
        ? null
        : input.items.filter(
            (item) =>
              item.kind === "event" &&
              item.startKey <= input.todayKey &&
              item.endKey >= input.todayKey,
          ).length,
    tasksToday: countTasks("danas"),
    tasksLate: countTasks("kasni"),
    focusMinutes:
      input.focusSessions === null
        ? null
        : input.focusSessions.reduce(
            (total, session) => total + focusSessionMinutes(session),
            0,
          ),
  };
}
