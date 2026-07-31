import { orderKanbanColumnKeys } from "@nexus/core";
import type { TaskKanbanViewSettings, TaskViewConfig } from "@nexus/core";

/**
 * The board's column-arrangement arithmetic (ADR-060), pure so the two
 * guarantees the feature makes are pinned by tests rather than by reading JSX:
 *
 *  - **Reachability.** `kanbanColumnRows` lists EVERY column of the current
 *    grouping — hidden ones included — in the exact order the board draws, so
 *    the „Kolone“ popover can always re-show what it hid.
 *  - **Never a silent loss.** `hiddenKanbanColumnCount` counts the columns the
 *    board is actually suppressing (stale keys count for nothing), and the
 *    page puts the „Skrivene kolone: N“ chip up exactly when it is positive.
 *
 * `keys` is always the CURRENT grouping's own column vocabulary in its natural
 * order — statuses, priorities urgent-first, or the list's section ids — which
 * is what makes a key stored for a deleted section stale here: it simply is
 * not in `keys`, so it is dropped on read (ADR-060) instead of drawing a ghost
 * or blocking a real column.
 */

/** One row of the „Kolone“ popover: a column key and whether the board hides it. */
export interface KanbanColumnRow {
  key: string;
  hidden: boolean;
}

/** Every column of the grouping in drawn order, each with its hidden flag — see the module doc. */
export function kanbanColumnRows(
  keys: readonly string[],
  settings: TaskKanbanViewSettings,
): KanbanColumnRow[] {
  const hidden = new Set(settings.hiddenColumns ?? []);
  return orderKanbanColumnKeys(keys, settings.columnOrder).map((key) => ({
    key,
    hidden: hidden.has(key),
  }));
}

/** How many of the grouping's columns the board is suppressing — the chip's number. */
export function hiddenKanbanColumnCount(
  keys: readonly string[],
  settings: TaskKanbanViewSettings,
): number {
  const hidden = new Set(settings.hiddenColumns ?? []);
  let count = 0;
  for (const key of keys) if (hidden.has(key)) count += 1;
  return count;
}

/**
 * The hidden set after toggling `key`, or `null` when hiding is REFUSED
 * because it would leave the board without a single drawn column
 * (`hasFixedColumn` says whether a keyless always-drawn column — the section
 * board's „Telo liste“ — keeps the board a board regardless). Stale keys are
 * dropped on the way through, so the stored set never accumulates dead ids.
 */
export function toggleKanbanColumnHidden(
  keys: readonly string[],
  settings: TaskKanbanViewSettings,
  key: string,
  hasFixedColumn: boolean,
): string[] | null {
  const hidden = (settings.hiddenColumns ?? []).filter((k) => keys.includes(k));
  if (hidden.includes(key)) return hidden.filter((k) => k !== key);
  if (!hasFixedColumn && hidden.length + 1 >= keys.length) return null;
  return [...hidden, key];
}

/**
 * A config with a section-grouped board's STALE column keys removed (ADR-060):
 * deleting a heading does not rewrite every stored config, and the store
 * refuses a write naming a section the list has not got — the right answer to
 * a caller inventing one, but a sunk unrelated write for an innocently stale
 * id. The page therefore prunes through this before EVERY config write, where
 * the live sections are known. Returns the input untouched (same reference)
 * when nothing is stale; a closed vocabulary (status/priority) is never stale.
 */
export function pruneStaleSectionColumns(
  config: TaskViewConfig,
  sectionIds: readonly string[],
): TaskViewConfig {
  const kanban = config.kanban;
  if (kanban === undefined || kanban.groupBy !== "section") return config;
  const live = new Set(sectionIds);
  const hidden = kanban.hiddenColumns?.filter((key) => live.has(key));
  const order = kanban.columnOrder?.filter((key) => live.has(key));
  const hiddenUntouched =
    kanban.hiddenColumns === undefined || hidden?.length === kanban.hiddenColumns.length;
  const orderUntouched =
    kanban.columnOrder === undefined || order?.length === kanban.columnOrder.length;
  if (hiddenUntouched && orderUntouched) return config;
  // `groupBy: "section"` is present by the guard above, so the rebuilt kanban
  // section is never empty — it keeps saying which board the arrangement was for.
  const next: TaskKanbanViewSettings = { groupBy: kanban.groupBy };
  if (kanban.sort !== undefined) next.sort = kanban.sort;
  if (kanban.filters !== undefined) next.filters = kanban.filters;
  if (hidden !== undefined && hidden.length > 0) next.hiddenColumns = hidden;
  if (order !== undefined && order.length > 0) next.columnOrder = order;
  return { ...config, kanban: next };
}

/**
 * The FULL drawn order with `key` stepped one place, or `null` at an edge (the
 * popover's ↑/↓ stay drawn but disabled there) and for a key the board does
 * not draw. Answering the whole list rather than a delta keeps the stored
 * `columnOrder` canonical: one arrangement, one written form.
 */
export function moveKanbanColumn(
  keys: readonly string[],
  settings: TaskKanbanViewSettings,
  key: string,
  delta: -1 | 1,
): string[] | null {
  const arranged = orderKanbanColumnKeys(keys, settings.columnOrder);
  const index = arranged.indexOf(key);
  const to = index + delta;
  if (index < 0 || to < 0 || to >= arranged.length) return null;
  const moved = arranged.splice(index, 1);
  arranged.splice(to, 0, ...moved);
  return arranged;
}
