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

/**
 * What a card knows about the board around it, so a module can offer a
 * KEYBOARD move without this view owning a menu: which column the card sits in,
 * and every column that is actually drawn, in drawing order. Enough to say
 * "one column left / one column right" — the same two-step gesture the drag
 * performs, reachable without a mouse.
 */
export interface KanbanCardContext {
  /** The card's own column: a groupBy option, or null for the ungrouped bucket. */
  groupValue: string | null;
  /** Every drawn column's value, in order — the ungrouped bucket included only when it is drawn. */
  columnValues: readonly (string | null)[];
}

export interface KanbanViewProps<T extends Record<string, unknown>> {
  items: readonly T[];
  schema: CollectionSchema;
  /** Kanban member of ViewConfig; persisting it is the caller's job (SET / module settings). */
  config: KanbanViewConfig;
  /** Renders one card's content — modules own card anatomy (typically a KanbanCard). */
  renderCard: (item: T, context: KanbanCardContext) => ReactNode;
  /**
   * Receives the dragged item and the engine's field patch (moveBetweenGroups)
   * on drop; the caller applies the patch to storage.
   */
  onMove: (item: T, patch: Record<string, string | null>) => void;
  /** Column title for the trailing bucket of items without a known groupBy value. */
  ungroupedTitle?: string;
  /**
   * Maps a column's groupBy value to a display title (labels are presentation;
   * the engine groups by value). Identity by default, so callers with
   * human-ready option values need not pass it.
   */
  columnTitle?: (value: string) => string;
  /** Stable React key per item; falls back to the render index. */
  itemKey?: (item: T) => string | number;
}

/**
 * Kanban view of the shared views engine (TASK-005). Filters, sorts, and
 * groups via @nexus/core; columns are the groupBy select field's options
 * (empty ones stay visible; the ungrouped bucket shows only when occupied,
 * unless the config's `ungroupedAlwaysShown` says it is a real place rather
 * than a leftovers pile — see `KanbanViewConfig`).
 * A drop asks the engine what the drag means (`moveBetweenGroups`) and
 * reports the patch through `onMove` — the view never mutates data.
 *
 * Drag & drop is native HTML5, confined to the card/column wrapper elements,
 * which is what lets a caller hang a keyboard alternative off the card body it
 * already renders: `renderCard` receives the card's own group value and the
 * ordered column values beside it, so a move-to-column menu (the TASK page's
 * ⋯ recipe) can be built without this component growing a menu of its own or
 * reshaping `onMove` — the a11y gap deferred from TASK-005 closes there.
 * Drop targets signal with a token-driven border/background shift — no glow,
 * per the direction brief.
 */
export function KanbanView<T extends Record<string, unknown>>({
  items,
  schema,
  config,
  renderCard,
  onMove,
  ungroupedTitle = "—",
  columnTitle,
  itemKey,
}: KanbanViewProps<T>) {
  const dragged = useRef<T | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  // The bucket for values outside the select's options is noise until something
  // lands in it — unless the config says it is a real place of its own (a task
  // list's BODY, under section grouping), in which case a column that comes and
  // goes with its contents is a drop target the user cannot rely on.
  const groups = groupForKanban(
    applySort(applyFilters(items, config.filters), config.sort, schema),
    config,
    schema,
  ).filter(
    (group) =>
      group.value !== null || group.items.length > 0 || config.ungroupedAlwaysShown === true,
  );
  const columnValues = groups.map((group) => group.value);

  const finishDrag = () => {
    dragged.current = null;
    setDropIndex(null);
  };

  return (
    <div className="nx-kanban-view">
      {groups.map((group, index) => {
        const isDropTarget = index === dropIndex;
        const title =
          group.value === null
            ? ungroupedTitle
            : columnTitle
              ? columnTitle(group.value)
              : group.value;
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
            <KanbanColumn title={title} count={group.items.length}>
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
                  {renderCard(item, { groupValue: group.value, columnValues })}
                </div>
              ))}
            </KanbanColumn>
          </div>
        );
      })}
    </div>
  );
}
