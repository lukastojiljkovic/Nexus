/** Sort order for one field; missing values always sort last (see engine). */
export interface SortSpec {
  field: string;
  direction: "asc" | "desc";
}

/**
 * Equality filter — v1 supports strict equality only. Richer predicates
 * (ranges, contains, priority queries) arrive with SRCH and the TASK smart
 * lists (TASK-003) as additional filter shapes, not a breaking change here.
 */
export interface FilterSpec {
  field: string;
  equals: unknown;
}

/** List layout: filtered and sorted rows, rendering owned by the module. */
export interface ListViewConfig {
  type: "list";
  sort?: SortSpec;
  filters?: FilterSpec[];
}

/** Kanban layout: columns from a select field (TASK-005 configurable grouping). */
export interface KanbanViewConfig {
  type: "kanban";
  /** Key of a select field in the schema; its options become the columns. */
  groupBy: string;
  sort?: SortSpec;
  filters?: FilterSpec[];
  /**
   * Whether the trailing ungrouped column is drawn even while it is empty
   * (ADR-050). Off by default, which is the rule every board has had: a bucket
   * for values outside the select's options is noise until something lands in
   * it.
   *
   * It lives on the CONFIG rather than on the view component because the answer
   * is a property of what is being grouped BY, not of one rendering: grouping a
   * task list by its sections makes the null bucket the list BODY — a real,
   * permanent place a task can be dragged back into — while grouping the same
   * rows by status or priority leaves it a genuine leftovers column. A
   * component prop would ask every call site to re-derive that from the
   * `groupBy` it just set, one field away from where it is decided.
   *
   * `groupForKanban` always EMITS the bucket regardless (a grouping is not a
   * rendering); this only says whether an empty one is worth a column.
   */
  ungroupedAlwaysShown?: boolean;
}

/**
 * Cards layout: the same filtered, sorted rows as the list, rendered as a
 * responsive grid of cards rather than rows. No grouping — a card grid's
 * structure is its order, and a second axis on top of it would be a board.
 */
export interface CardsViewConfig {
  type: "cards";
  sort?: SortSpec;
  filters?: FilterSpec[];
}

/**
 * Calendar layout: filtered rows placed on a date grid.
 *
 * Deliberately NO sort. A calendar's order IS the calendar — every item sits on
 * the day its own date names — so a sort spec here could only be a promise the
 * layout cannot keep.
 */
export interface CalendarViewConfig {
  type: "calendar";
  filters?: FilterSpec[];
}

/**
 * Per-view configuration (TASK-005, completed by ADR-050). The engine is pure —
 * persistence of configs (per-list view memory, TASK-004) is owned by callers
 * via SET / module settings, which for the TASK module is `task_lists.view_config`
 * (migration 038).
 */
export type ViewConfig =
  | ListViewConfig
  | KanbanViewConfig
  | CardsViewConfig
  | CalendarViewConfig;
