import { useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  applyFilters,
  applySort,
  groupForKanban,
  moveBetweenGroups,
} from "@nexus/core";
import type { CollectionSchema, KanbanViewConfig } from "@nexus/core";
import { KanbanColumn } from "../components/Kanban.js";

export interface KanbanViewProps<T extends Record<string, unknown>> {
  items: readonly T[];
  schema: CollectionSchema;
  /** Kanban member of ViewConfig; persisting it is the caller's job (SET / module settings). */
  config: KanbanViewConfig;
  /** Renders one card's content — modules own card anatomy (typically a KanbanCard). */
  renderCard: (item: T) => ReactNode;
  /**
   * Receives the dragged item and the engine's field patch (moveBetweenGroups)
   * on drop; the caller applies the patch to storage.
   */
  onMove: (item: T, patch: Record<string, string | null>) => void;
  /** Column title for the trailing bucket of items without a known groupBy value. */
  ungroupedTitle?: string;
  /** Stable React key per item; falls back to the render index. */
  itemKey?: (item: T) => string | number;
}

/**
 * Kanban view of the shared views engine (TASK-005). Filters, sorts, and
 * groups via @nexus/core; columns are the groupBy select field's options
 * (empty ones stay visible; the ungrouped bucket shows only when occupied).
 * A drop asks the engine what the drag means (`moveBetweenGroups`) and
 * reports the patch through `onMove` — the view never mutates data.
 *
 * Drag & drop is native HTML5, confined to the card/column wrapper elements
 * so a keyboard alternative (e.g. a move-to-column menu) can be added there
 * later without reshaping this API (deferred from this milestone). Drop
 * targets signal with a token-driven border/background shift — no glow, per
 * the direction brief.
 */
export function KanbanView<T extends Record<string, unknown>>({
  items,
  schema,
  config,
  renderCard,
  onMove,
  ungroupedTitle = "—",
  itemKey,
}: KanbanViewProps<T>) {
  const dragged = useRef<T | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const groups = groupForKanban(
    applySort(applyFilters(items, config.filters), config.sort, schema),
    config,
    schema,
  );

  const finishDrag = () => {
    dragged.current = null;
    setDropIndex(null);
  };

  return (
    <div className="nx-kanban-view">
      {groups.map((group, index) => {
        if (group.value === null && group.items.length === 0) return null;
        const isDropTarget = index === dropIndex;
        return (
          <div
            key={group.value ?? "__ungrouped__"}
            className={
              isDropTarget
                ? "nx-kanban-view__col nx-kanban-view__col--drop"
                : "nx-kanban-view__col"
            }
            onDragOver={(e) => {
              if (!dragged.current) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              if (!isDropTarget) setDropIndex(index);
            }}
            onDragLeave={(e) => {
              if (isDropTarget && !e.currentTarget.contains(e.relatedTarget as Node | null)) {
                setDropIndex(null);
              }
            }}
            onDrop={(e) => {
              const item = dragged.current;
              if (!item) return;
              e.preventDefault();
              onMove(item, moveBetweenGroups(item, group.value, config));
              finishDrag();
            }}
          >
            <KanbanColumn title={group.value ?? ungroupedTitle} count={group.items.length}>
              {group.items.map((item, itemIndex) => (
                <div
                  key={itemKey ? itemKey(item) : itemIndex}
                  className="nx-kanban-view__card"
                  draggable
                  onDragStart={(e) => {
                    dragged.current = item;
                    e.dataTransfer.effectAllowed = "move";
                    // Firefox needs a payload for the drag to start; identity travels via ref.
                    e.dataTransfer.setData(
                      "text/plain",
                      String(itemKey ? itemKey(item) : itemIndex),
                    );
                  }}
                  onDragEnd={finishDrag}
                >
                  {renderCard(item)}
                </div>
              ))}
            </KanbanColumn>
          </div>
        );
      })}
    </div>
  );
}
