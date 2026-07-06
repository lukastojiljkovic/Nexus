/**
 * Field value types the views engine can filter, sort, and group on
 * (docs/research/design-system.md conclusion #3 — one engine, every module).
 * `date` values are ISO-8601 strings and compare as strings.
 */
export type FieldType = "text" | "date" | "select" | "boolean" | "number";

interface FieldDefBase {
  /** Item property this field reads, e.g. "dueDate". */
  key: string;
  /** i18n key for the field's display label. */
  titleKey: string;
}

/** A closed-choice field; kanban columns come from its `options`, in order. */
export interface SelectFieldDef extends FieldDefBase {
  type: "select";
  /** Allowed values, in display (column) order. */
  options: readonly string[];
}

/** Any non-select field; select is split off so `options` is required there. */
export interface ScalarFieldDef extends FieldDefBase {
  type: Exclude<FieldType, "select">;
}

export type FieldDef = ScalarFieldDef | SelectFieldDef;

/**
 * The field declarations for one collection of items (e.g. a task list).
 * Modules describe their fields once; the engine derives view behavior.
 */
export interface CollectionSchema {
  fields: FieldDef[];
}
