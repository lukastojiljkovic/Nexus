import type { ReactNode } from "react";
import { applyFilters, applySort } from "@nexus/core";
import type { CollectionSchema, ListViewConfig } from "@nexus/core";

export interface ListViewProps<T extends Record<string, unknown>> {
  items: readonly T[];
  schema: CollectionSchema;
  /** List member of ViewConfig; persisting it is the caller's job (SET / module settings). */
  config: ListViewConfig;
  /** Renders one row — modules own row content (typically a ListRow); the engine owns order. */
  renderItem: (item: T) => ReactNode;
  /** Stable React key per item; falls back to the render index. */
  itemKey?: (item: T) => string | number;
}

/**
 * List view of the shared views engine (TASK-005). Applies the config's
 * filters and sort via @nexus/core — the single source of ordering truth —
 * and delegates row rendering to the module. Stateless over data: props in.
 *
 * ROW ACTIVATION IS THE ROW'S, NOT THE WRAPPER'S. An `onItemClick` prop lived
 * here and in `CardsView`, with a `--clickable` modifier and a hover rule
 * behind it, and in the whole product no caller ever passed one — so the two
 * style rules could never match anything and the hover they describe had never
 * been on a screen. That is not an oversight to be filled in later, it is the
 * design being right: what a row does when it is clicked is a module's
 * decision, the module already renders the row's contents, and a click handler
 * on a plain `<div>` wrapper is unreachable by keyboard anyway — it would have
 * shipped a control that only a mouse can operate. Modules put a real button
 * or link inside `renderItem` instead, which is where the accessible name and
 * the focus ring already are. Deleted rather than left declared: an unused
 * prop reads as a supported feature to the next caller.
 */
export function ListView<T extends Record<string, unknown>>({
  items,
  schema,
  config,
  renderItem,
  itemKey,
}: ListViewProps<T>) {
  const visible = applySort(applyFilters(items, config.filters), config.sort, schema);
  return (
    <div className="nx-list-view">
      {visible.map((item, index) => (
        <div key={itemKey ? itemKey(item) : index} className="nx-list-view__item">
          {renderItem(item)}
        </div>
      ))}
    </div>
  );
}
