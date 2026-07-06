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
  onItemClick?: (item: T) => void;
  /** Stable React key per item; falls back to the render index. */
  itemKey?: (item: T) => string | number;
}

/**
 * List view of the shared views engine (TASK-005). Applies the config's
 * filters and sort via @nexus/core — the single source of ordering truth —
 * and delegates row rendering to the module. Stateless over data: props in,
 * clicks out. Keyboard row activation lands with the views-engine a11y pass.
 */
export function ListView<T extends Record<string, unknown>>({
  items,
  schema,
  config,
  renderItem,
  onItemClick,
  itemKey,
}: ListViewProps<T>) {
  const visible = applySort(applyFilters(items, config.filters), config.sort, schema);
  return (
    <div className="nx-list-view">
      {visible.map((item, index) => (
        <div
          key={itemKey ? itemKey(item) : index}
          className={
            onItemClick
              ? "nx-list-view__item nx-list-view__item--clickable"
              : "nx-list-view__item"
          }
          onClick={onItemClick ? () => onItemClick(item) : undefined}
        >
          {renderItem(item)}
        </div>
      ))}
    </div>
  );
}
