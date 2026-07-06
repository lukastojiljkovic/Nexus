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
}

/**
 * Per-view configuration (TASK-005). The engine is pure — persistence of
 * configs (per-list view memory, TASK-004) is owned by callers via SET /
 * module settings. Cards and calendar variants join this union in the next
 * views-engine iteration.
 */
export type ViewConfig = ListViewConfig | KanbanViewConfig;
