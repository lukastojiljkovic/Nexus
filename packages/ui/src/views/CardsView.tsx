import type { ReactNode } from "react";
import { applyFilters, applySort } from "@nexus/core";
import type { CardsViewConfig, CollectionSchema } from "@nexus/core";

export interface CardsViewProps<T extends Record<string, unknown>> {
  items: readonly T[];
  schema: CollectionSchema;
  /** Cards member of ViewConfig; persisting it is the caller's job (SET / module settings). */
  config: CardsViewConfig;
  /** Renders one card's content — modules own card anatomy; the engine owns order. */
  renderItem: (item: T) => ReactNode;
  /** Stable React key per item; falls back to the render index. */
  itemKey?: (item: T) => string | number;
}

/**
 * Cards view of the shared views engine (ADR-050) — `ListView`'s pipeline laid
 * out as a grid instead of a column. Applies the config's filters and sort via
 * @nexus/core, the single source of ordering truth, and delegates the card body
 * to the module. Stateless over data: props in.
 *
 * Card activation belongs to the card, not to this wrapper — the reasoning is
 * on `ListView`, where the same dead `onItemClick` was deleted.
 *
 * There is deliberately no grouping here. A card grid's structure IS its order,
 * and a second axis over it would be the kanban view — which already exists,
 * one file over.
 *
 * The grid itself is `repeat(auto-fill, minmax(240px, 1fr))` in CSS, so the
 * column count follows the available width with no measurement, no breakpoint
 * list and nothing for this component to know about its container.
 */
export function CardsView<T extends Record<string, unknown>>({
  items,
  schema,
  config,
  renderItem,
  itemKey,
}: CardsViewProps<T>) {
  const visible = applySort(applyFilters(items, config.filters), config.sort, schema);
  return (
    <div className="nx-cards-view">
      {visible.map((item, index) => (
        <div key={itemKey ? itemKey(item) : index} className="nx-cards-view__card">
          {renderItem(item)}
        </div>
      ))}
    </div>
  );
}
