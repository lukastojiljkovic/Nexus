import { matchesSmartList, selectSmartList } from "@nexus/core";
import type { SmartListContext, SmartListTask } from "@nexus/core";

/**
 * The configurable widgets' row selection, pure (DASH-004 / ADR-059) — what
 * each card body ran inline until the config knobs landed, lifted here so the
 * one thing the knobs change is testable without a DOM (`dashboardLayout.ts`'s
 * reason, one file over). Each selector's DEFAULT-config path is pinned by
 * tests as exactly the card's shipped behaviour: an absent config must render
 * the widget as it always has.
 */

/** The three knobs „Predstojeći zadaci" declares, already parsed and defaulted. */
export interface UpcomingRowsConfig {
  /** Row cap; `Infinity` never occurs here (the field's default is 5). */
  cap: number;
  /** `"svi"` (no window, as shipped) or a TASK smart-list window (`"danas"` / `"sledecih7"`). */
  period: string;
  /** Selected task-list ids; empty means every list. */
  listIds: readonly string[];
}

/**
 * The card reads the task list alone and never the dependency edges, so it has
 * no honest way to tell a blocked task from a free one (ADR-037) — the same
 * `includeBlocked: true` posture every dashboard card takes.
 */
function widgetSmartListContext(today: string): SmartListContext {
  return { today, isBlocked: () => false, includeBlocked: true };
}

/**
 * „Predstojeći zadaci“ (`tasks:predstojece`): active tasks by rok (undated
 * last), then age — through the period window and the list filter, capped.
 * The two windows are TASK's own smart-list predicates (ADR-049), so the card
 * and those views cannot drift on what „danas“ or a week means.
 */
export function upcomingTaskRows<T extends SmartListTask & { listId: string }>(
  tasks: readonly T[],
  today: string,
  config: UpcomingRowsConfig,
): T[] {
  const context = widgetSmartListContext(today);
  const selected = new Set(config.listIds);
  return tasks
    .filter((task) => !task.done)
    .filter(
      (task) =>
        config.period === "danas" || config.period === "sledecih7"
          ? matchesSmartList(task, config.period, context)
          : true, // „svi“ — the shipped no-window reading
    )
    .filter((task) => selected.size === 0 || selected.has(task.listId))
    .sort((a, b) => {
      if (a.dueDate == null && b.dueDate == null) return a.createdAt.localeCompare(b.createdAt);
      if (a.dueDate == null) return 1;
      if (b.dueDate == null) return -1;
      return a.dueDate.localeCompare(b.dueDate) || a.createdAt.localeCompare(b.createdAt);
    })
    .slice(0, config.cap);
}

/**
 * „Hitno i kasni“ (`tasks:hitno-kasni`): every late task first, longest
 * overdue leading, then every high-priority task not already among them,
 * earliest rok first — the two smart lists' OWN orders (`selectSmartList`),
 * with the cap on the UNION rather than on each half, since a late row can
 * also be high.
 */
export function urgentTaskRows<T extends SmartListTask>(
  tasks: readonly T[],
  today: string,
  cap: number,
): T[] {
  const context = widgetSmartListContext(today);
  const late = selectSmartList(tasks, "kasni", context);
  const lateIds = new Set(late.map((task) => task.id));
  const urgent = selectSmartList(tasks, "hitno", context).filter((task) => !lateIds.has(task.id));
  return [...late, ...urgent].slice(0, cap);
}

/**
 * The day window a horizon option means, or `null` for the choice's own
 * default reading — „prag“ (each document's reminder ladder) on the documents
 * card, „svi“ (every upcoming exam) on the exams card.
 */
export function horizonWindowDays(choice: string): number | null {
  return choice === "30" || choice === "60" || choice === "90" ? Number(choice) : null;
}

/**
 * „Dokumenta koja ističu“ (`calendar:isticanja`), soonest first: under „prag“
 * everything past its own reminder threshold (the shipped behaviour, the
 * store's derived `status`); under a day horizon everything expiring within
 * that many days — the already-expired included, since a window on "how soon"
 * can only ever contain what is soonest of all.
 */
export function expiringDocumentRows<
  T extends { id: string; status: string; daysUntilExpiry: number },
>(documents: readonly T[], horizon: string): T[] {
  const window = horizonWindowDays(horizon);
  return documents
    .filter((doc) => (window === null ? doc.status !== "ok" : doc.daysUntilExpiry <= window))
    .sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry || a.id.localeCompare(b.id));
}

/**
 * „Danas“'s (`calendar:danas`) row cap, applied JOINTLY across its three
 * groups in draw order — events, then birthdays, then tasks — so „Broj
 * redova: 5“ means five rows on the card, not five per section. The shipped
 * default is `Infinity`: no cap at all.
 */
export function capTodayGroups<E, B, T>(
  cap: number,
  events: readonly E[],
  birthdays: readonly B[],
  tasks: readonly T[],
): { events: E[]; birthdays: B[]; tasks: T[] } {
  const keptEvents = events.slice(0, cap);
  const keptBirthdays = birthdays.slice(0, Math.max(0, cap - keptEvents.length));
  const keptTasks = tasks.slice(0, Math.max(0, cap - keptEvents.length - keptBirthdays.length));
  return { events: keptEvents, birthdays: keptBirthdays, tasks: keptTasks };
}
