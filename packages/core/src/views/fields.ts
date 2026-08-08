/**
 * Field value types the views engine can filter, sort, and group on
 * (docs/research/design-system.md conclusion #3 — one engine, every module).
 * `date` values are ISO-8601 strings and compare as strings.
 */
export type FieldType = "text" | "date" | "select" | "boolean" | "number";

interface FieldDefBase {
  /** Item property this field reads, e.g. "dueDate". */
  key: string;
  /**
   * i18n key for the field's display label — OPTIONAL, and unread by anything
   * today.
   *
   * It was required, and every supplied value was wrong: all sixteen field
   * declarations in the desktop app pointed at `strings` paths that do not exist
   * (`tasks.field.title`, `notes.field.pinned`, `finance.field.amount`, …).
   * Nothing ever resolved them, so nothing ever noticed — a required property no
   * reader validates is a required property that drifts, silently, at every call
   * site at once.
   *
   * The engine itself has no use for a label: it filters, sorts and groups by
   * `key` and `type`, and every surface that draws a field header already has
   * its own Serbian copy from `strings.ts`. Optional is therefore the honest
   * shape — a field MAY name a label key, and when a surface finally wants to
   * read one, the keys it reads will be checked against `strings` the way
   * `ToolRegistration.titleKey` and the settings panels' already are.
   *
   * `| undefined` is explicit rather than accidental. Under
   * `exactOptionalPropertyTypes` a plain `titleKey?: string` refuses
   * `titleKey: field.titleKey` — which is exactly what `TasksPage` writes when it
   * rebuilds a field definition by copying one — and widening here is the narrow
   * change, where forcing every copier to spell out an omission is the wide one.
   * Once the dead values are stripped from the call sites, this can go back to a
   * bare `titleKey?: string`.
   */
  titleKey?: string | undefined;
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
