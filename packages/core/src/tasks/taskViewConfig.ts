import type { FilterSpec } from "../views/viewConfig.js";

/**
 * What ONE task list remembers about each of its four views (ADR-050) — the
 * shape stored as JSON in `task_lists.view_config` (migration 038), written by
 * `TaskListStore.setViewConfig` and carried by the interchange's `task-list`
 * record.
 *
 * It lives in `@nexus/core` rather than in the store or the page because all
 * three of them need the identical answer to "is this a config": the store
 * validates it on the way in, the archive reader validates the same shape out
 * of an untrusted file, and the renderer reads it back to decide what the
 * selects show. Three copies of one grammar could only drift.
 *
 * **Two readings of the same grammar, on purpose.**
 *  - `validateTaskViewConfig` is STRICT: an unrecognized key, a sort field
 *    outside the schema, a status the domain does not have — any of them makes
 *    the whole value `null`, i.e. "this is not a config". That is the posture a
 *    WRITE needs (SEC-EL-02: the renderer is untrusted) and the posture an
 *    archive reader needs (a hand-edited file must not smuggle a shape past the
 *    gate).
 *  - `normalizeTaskViewConfig` is LENIENT: it keeps what it recognizes and
 *    drops the rest. That is the posture a READ of an already-stored config
 *    needs, and it is the whole safety property this feature rests on — a
 *    config can only ever cost the user a fallback to the default view, never
 *    an unopenable list.
 *
 * Neither ever returns any part of its input: every accepted value is copied
 * into a freshly built object, so no prototype, no extra key and no aliased
 * array can ride along.
 */

/**
 * The fields a task view may sort by — `TASK_SCHEMA`'s own keys (TasksPage),
 * copied rather than imported for the reason `TASK_LIST_VIEWS` is copied into
 * the archive reader: the schema is a renderer-side declaration, and a package
 * boundary is not worth crossing for seven strings. A field outside this set is
 * refused, so a stored config can never ask `applySort` for a key the schema
 * has no comparator for.
 */
export const TASK_VIEW_SORT_FIELDS = [
  "title",
  "status",
  "priority",
  "dueDate",
  "startDate",
  "completedAt",
  "done",
] as const;
export type TaskViewSortField = (typeof TASK_VIEW_SORT_FIELDS)[number];

export const TASK_VIEW_SORT_DIRECTIONS = ["asc", "desc"] as const;
export type TaskViewSortDirection = (typeof TASK_VIEW_SORT_DIRECTIONS)[number];

/**
 * What a task board's columns come from. `"status"` and `"priority"` are select
 * fields of the schema; `"section"` is the list's own headings, which the page
 * turns into a select field per render (its options are that list's section
 * ids), so the engine still only ever groups by a select field.
 */
export const TASK_VIEW_KANBAN_GROUPS = ["status", "priority", "section"] as const;
export type TaskViewKanbanGroup = (typeof TASK_VIEW_KANBAN_GROUPS)[number];

/** Mirrors `TASK_STATUSES` in `@nexus/db`'s `tasks/taskStore.ts` and migration 002's CHECK. */
export const TASK_VIEW_FILTER_STATUSES = ["todo", "doing", "done"] as const;
/** Mirrors `TASK_PRIORITIES` in the same store and migration 002's CHECK. */
export const TASK_VIEW_FILTER_PRIORITIES = ["none", "low", "medium", "high"] as const;

export type TaskViewFilterStatus = (typeof TASK_VIEW_FILTER_STATUSES)[number];
export type TaskViewFilterPriority = (typeof TASK_VIEW_FILTER_PRIORITIES)[number];

/** Structurally a `SortSpec`, with the field narrowed to what the schema can compare. */
export interface TaskViewSort {
  field: TaskViewSortField;
  direction: TaskViewSortDirection;
}

/**
 * The equality filters a task view may carry — status and priority only, each
 * at most once. An OBJECT rather than a list of pairs, because "status equals
 * two different things at once" is not a filter anybody can mean, and a shape
 * that cannot express it needs no rule against it.
 */
export interface TaskViewFilters {
  status?: TaskViewFilterStatus;
  priority?: TaskViewFilterPriority;
}

/** The list and cards views: same two knobs, since they are one ordering shown two ways. */
export interface TaskSortedViewSettings {
  sort?: TaskViewSort;
  filters?: TaskViewFilters;
}

export interface TaskKanbanViewSettings extends TaskSortedViewSettings {
  groupBy?: TaskViewKanbanGroup;
}

/** The calendar view: filters only — its order is the calendar's (see `CalendarViewConfig`). */
export interface TaskCalendarViewSettings {
  filters?: TaskViewFilters;
}

export interface TaskViewConfig {
  list?: TaskSortedViewSettings;
  kanban?: TaskKanbanViewSettings;
  cards?: TaskSortedViewSettings;
  calendar?: TaskCalendarViewSettings;
}

/** Reading mode: `"strict"` refuses the whole value on anything unrecognized, `"lenient"` drops it. */
type Mode = "strict" | "lenient";

/** Thrown internally by the strict pass and never escapes this module — `validateTaskViewConfig` turns it into `null`. */
class RejectedError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * `undefined` when the value is absent, the member when it is one of `allowed`,
 * and otherwise either a rejection (strict) or `undefined` (lenient). An
 * explicit `null` counts as absent in both modes: a writer that cleared a knob
 * and one that never set it mean the same thing here.
 */
function member<T extends string>(
  value: unknown,
  allowed: readonly T[],
  mode: Mode,
): T | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") {
    for (const option of allowed) if (option === value) return option;
  }
  if (mode === "strict") throw new RejectedError();
  return undefined;
}

/** Refuses (strict) or ignores (lenient) any key the shape does not declare — the "unknown keys dropped" rule, one level at a time. */
function assertKnownKeys(raw: Record<string, unknown>, known: readonly string[], mode: Mode): void {
  if (mode !== "strict") return;
  for (const key of Object.keys(raw)) {
    if (!known.includes(key)) throw new RejectedError();
  }
}

function readSort(value: unknown, mode: Mode): TaskViewSort | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) {
    if (mode === "strict") throw new RejectedError();
    return undefined;
  }
  assertKnownKeys(value, ["field", "direction"], mode);
  const field = member(value["field"], TASK_VIEW_SORT_FIELDS, mode);
  const direction = member(value["direction"], TASK_VIEW_SORT_DIRECTIONS, mode);
  // Both halves or nothing: a direction without a field sorts by nothing, and a
  // field without a direction would have this module inventing one.
  if (field === undefined || direction === undefined) {
    if (mode === "strict" && (field !== undefined || direction !== undefined)) {
      throw new RejectedError();
    }
    return undefined;
  }
  return { field, direction };
}

function readFilters(value: unknown, mode: Mode): TaskViewFilters | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) {
    if (mode === "strict") throw new RejectedError();
    return undefined;
  }
  assertKnownKeys(value, ["status", "priority"], mode);
  const status = member(value["status"], TASK_VIEW_FILTER_STATUSES, mode);
  const priority = member(value["priority"], TASK_VIEW_FILTER_PRIORITIES, mode);
  const filters: TaskViewFilters = {};
  if (status !== undefined) filters.status = status;
  if (priority !== undefined) filters.priority = priority;
  return Object.keys(filters).length === 0 ? undefined : filters;
}

function readSorted(value: unknown, mode: Mode): TaskSortedViewSettings | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) {
    if (mode === "strict") throw new RejectedError();
    return undefined;
  }
  assertKnownKeys(value, ["sort", "filters"], mode);
  const sort = readSort(value["sort"], mode);
  const filters = readFilters(value["filters"], mode);
  const settings: TaskSortedViewSettings = {};
  if (sort !== undefined) settings.sort = sort;
  if (filters !== undefined) settings.filters = filters;
  return Object.keys(settings).length === 0 ? undefined : settings;
}

function readKanban(value: unknown, mode: Mode): TaskKanbanViewSettings | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) {
    if (mode === "strict") throw new RejectedError();
    return undefined;
  }
  assertKnownKeys(value, ["groupBy", "sort", "filters"], mode);
  const groupBy = member(value["groupBy"], TASK_VIEW_KANBAN_GROUPS, mode);
  const sort = readSort(value["sort"], mode);
  const filters = readFilters(value["filters"], mode);
  const settings: TaskKanbanViewSettings = {};
  if (groupBy !== undefined) settings.groupBy = groupBy;
  if (sort !== undefined) settings.sort = sort;
  if (filters !== undefined) settings.filters = filters;
  return Object.keys(settings).length === 0 ? undefined : settings;
}

function readCalendar(value: unknown, mode: Mode): TaskCalendarViewSettings | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) {
    if (mode === "strict") throw new RejectedError();
    return undefined;
  }
  assertKnownKeys(value, ["filters"], mode);
  const filters = readFilters(value["filters"], mode);
  return filters === undefined ? undefined : { filters };
}

function read(value: unknown, mode: Mode): TaskViewConfig {
  if (!isRecord(value)) {
    if (mode === "strict") throw new RejectedError();
    return {};
  }
  assertKnownKeys(value, ["list", "kanban", "cards", "calendar"], mode);
  const list = readSorted(value["list"], mode);
  const kanban = readKanban(value["kanban"], mode);
  const cards = readSorted(value["cards"], mode);
  const calendar = readCalendar(value["calendar"], mode);
  const config: TaskViewConfig = {};
  if (list !== undefined) config.list = list;
  if (kanban !== undefined) config.kanban = kanban;
  if (cards !== undefined) config.cards = cards;
  if (calendar !== undefined) config.calendar = calendar;
  return config;
}

/**
 * Structural validation of an untrusted value into a canonical config, or
 * `null` when it is not one. An empty-but-well-formed value returns `{}` — the
 * caller's own "clear it" and "this is garbage" are different answers, so they
 * get different return values.
 */
export function validateTaskViewConfig(value: unknown): TaskViewConfig | null {
  if (value === undefined || value === null) return {};
  try {
    return read(value, "strict");
  } catch (error) {
    if (error instanceof RejectedError) return null;
    throw error;
  }
}

/** Everything recognizable in `value`, with the rest dropped — never `null`, never a throw (see the file header). */
export function normalizeTaskViewConfig(value: unknown): TaskViewConfig {
  return read(value, "lenient");
}

/** True when a config asks for nothing at all, and therefore need not be stored. */
export function isEmptyTaskViewConfig(config: TaskViewConfig): boolean {
  return Object.keys(config).length === 0;
}

/**
 * The stored column read leniently: unparseable JSON, a non-object, and a
 * config with nothing left after normalizing all come back as `null`, which
 * every reader already treats as "this list has no preferences".
 */
export function parseStoredTaskViewConfig(text: string | null): TaskViewConfig | null {
  if (text === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const config = normalizeTaskViewConfig(parsed);
  return isEmptyTaskViewConfig(config) ? null : config;
}

/** The column value for a config: its JSON, or `null` when it asks for nothing. */
export function serializeTaskViewConfig(config: TaskViewConfig | null): string | null {
  if (config === null || isEmptyTaskViewConfig(config)) return null;
  return JSON.stringify(config);
}

/**
 * One view's filters as the engine's own `FilterSpec` list, in a fixed order so
 * two equal configs produce two equal specs. Absent knobs contribute nothing,
 * which is exactly what `applyFilters` reads as "no filtering".
 */
export function taskViewFilterSpecs(filters: TaskViewFilters | undefined): FilterSpec[] {
  if (filters === undefined) return [];
  const specs: FilterSpec[] = [];
  if (filters.status !== undefined) specs.push({ field: "status", equals: filters.status });
  if (filters.priority !== undefined) specs.push({ field: "priority", equals: filters.priority });
  return specs;
}
