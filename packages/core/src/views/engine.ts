import type { CollectionSchema, FieldDef, FieldType } from "./fields.js";
import type { FilterSpec, KanbanViewConfig, SortSpec } from "./viewConfig.js";

/**
 * Thrown when a view config references a field the schema cannot support
 * (unknown key, or a kanban groupBy that is not a select field).
 */
export class ViewConfigError extends Error {
  constructor(
    /** The offending field key from the view config. */
    readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = "ViewConfigError";
  }
}

/**
 * Serbian Latin collation for text fields (launch script; c < č < ć < d,
 * s < š < t). Plain "sr" resolves to the Cyrillic tailoring, which leaves
 * Latin diacritics at root weights and misorders them.
 */
const collator = new Intl.Collator(["sr-Latn", "sr"]);

const comparators: Record<FieldType, (a: unknown, b: unknown) => number> = {
  text: (a, b) => collator.compare(String(a), String(b)),
  select: (a, b) => collator.compare(String(a), String(b)),
  date: (a, b) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0),
  number: (a, b) => Number(a) - Number(b),
  boolean: (a, b) => Number(Boolean(a)) - Number(Boolean(b)),
};

function fieldDef(schema: CollectionSchema, key: string): FieldDef {
  const def = schema.fields.find((f) => f.key === key);
  if (!def) {
    throw new ViewConfigError(key, `Field "${key}" is not in the schema.`);
  }
  return def;
}

/**
 * Items passing every filter, by strict equality (v1 — see FilterSpec).
 * With no filters the input array is returned as-is.
 */
export function applyFilters<T extends Record<string, unknown>>(
  items: readonly T[],
  filters?: readonly FilterSpec[],
): readonly T[] {
  if (!filters || filters.length === 0) return items;
  return items.filter((item) => filters.every((f) => item[f.field] === f.equals));
}

/**
 * Items in sort order, compared per the schema's field type: text collates
 * with the Serbian locale, dates compare as ISO-8601 strings, numbers and
 * booleans numerically. The sort is stable, and items missing the field
 * (null/undefined) go last regardless of direction. Throws ViewConfigError
 * if the field is not in the schema. Without a sort the input is returned
 * as-is.
 */
export function applySort<T extends Record<string, unknown>>(
  items: readonly T[],
  sort: SortSpec | undefined,
  schema: CollectionSchema,
): readonly T[] {
  if (!sort) return items;
  const compare = comparators[fieldDef(schema, sort.field).type];
  const dir = sort.direction === "desc" ? -1 : 1;
  return [...items].sort((a, b) => {
    const va = a[sort.field];
    const vb = b[sort.field];
    if (va == null || vb == null) {
      return (va == null ? 1 : 0) - (vb == null ? 1 : 0);
    }
    return dir * compare(va, vb);
  });
}

/** One kanban column's worth of items. */
export interface KanbanGroup<T> {
  /** The select option value, or null for the trailing ungrouped bucket. */
  value: string | null;
  items: T[];
}

/**
 * Items bucketed into kanban columns: one group per option of the groupBy
 * select field, in options order — empty groups included so columns are
 * stable — plus a trailing ungrouped bucket (value null) for items whose
 * value is missing or not a known option. Input order is preserved within
 * groups; sort before grouping. Throws ViewConfigError if groupBy is not a
 * select field in the schema.
 *
 * The ungrouped bucket is ALWAYS emitted, empty or not: whether an empty one
 * earns a column on screen is a rendering question, answered by the config's
 * `ungroupedAlwaysShown` where the columns are drawn (see `KanbanViewConfig`).
 */
export function groupForKanban<T extends Record<string, unknown>>(
  items: readonly T[],
  config: KanbanViewConfig,
  schema: CollectionSchema,
): KanbanGroup<T>[] {
  const def = fieldDef(schema, config.groupBy);
  if (def.type !== "select") {
    throw new ViewConfigError(
      config.groupBy,
      `Kanban groupBy field "${config.groupBy}" must be a select field, got "${def.type}".`,
    );
  }
  const optionGroups = def.options.map(
    (value): KanbanGroup<T> => ({ value, items: [] }),
  );
  const ungrouped: KanbanGroup<T> = { value: null, items: [] };
  const byValue = new Map(optionGroups.map((g) => [g.value, g]));
  for (const item of items) {
    const value = item[config.groupBy];
    const group =
      (typeof value === "string" ? byValue.get(value) : undefined) ?? ungrouped;
    group.items.push(item);
  }
  return [...optionGroups, ungrouped];
}

/**
 * The field patch a drop between kanban columns means: set the grouped field
 * to the target column's option, or clear it (null) for the ungrouped bucket.
 * The engine owns drag semantics; callers apply the patch to storage — that
 * is how "drag between columns updates the grouped field" (TASK-005) stays
 * view-agnostic. `item` is unused in v1; it is part of the signature so
 * intra-column ordering semantics can land without an API break.
 */
export function moveBetweenGroups(
  item: Record<string, unknown>,
  toGroupValue: string | null,
  config: KanbanViewConfig,
): Record<string, string | null> {
  return { [config.groupBy]: toGroupValue };
}
