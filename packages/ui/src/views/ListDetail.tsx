import { useId, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";

import { Button } from "../components/Button.js";
import { Icon } from "../components/Icon.js";
import {
  listDetailFocusIndex,
  listDetailKeyIntent,
  listDetailRowProps,
  listDetailStep,
} from "./listDetailKeys.js";

export interface ListDetailProps<T> {
  /** The rows, in the order they are read. */
  readonly items: readonly T[];
  /** The stable id of one row. It is what the selection names, and what the URL carries. */
  readonly itemKey: (item: T) => string;
  /** The list's own name, announced on the listbox. */
  readonly listLabel: string;
  /** The detail pane's name, announced on its region. */
  readonly detailLabel: string;
  /**
   * One row's content. It carries no interactive children of its own: a row is
   * an `option`, and a button inside an option is a control no screen reader
   * can describe or reach in the way it expects. A row's own actions belong to
   * the detail pane.
   */
  readonly renderRow: (item: T) => ReactNode;
  /** The detail for the open row, or the pane's own empty state when none is open. */
  readonly renderDetail: (item: T | null) => ReactNode;
  readonly selectedId: string | null;
  readonly onSelect: (id: string | null) => void;
  /** The name of the control that leaves the detail and returns to the list. */
  readonly backLabel: string;
  /** Extra class on the wrapper, for a page that places the pair in its own grid. */
  readonly className?: string;
}

/**
 * A list and its detail, side by side — and under 1100px, the detail AS the
 * full view, with a way back.
 *
 * **Why this is a component rather than an arrangement.** The pages that
 * already draw a rail beside a pane draw it out of buttons, so the rail is one
 * Tab stop per row, the arrow keys do nothing and Escape is not part of it. The
 * arrangement is not what is missing; the model is, and a model copied into
 * every page that wants one is that many models.
 *
 * **The model** is the APG's single-select listbox with selection following
 * focus: one tab stop, ↑/↓ walk the rows and wrap, Enter opens the row under
 * the keyboard, Escape closes it and puts the keyboard back on the row it named.
 * `listDetailKeys.ts` holds every one of those decisions as a value, which is
 * where the tests pin them.
 *
 * **The selection is not this component's to keep.** It arrives as
 * `selectedId` and leaves as `onSelect`, because the two hosts want different
 * things from it: a surface that wants a row to be addressable backs it with
 * `useListDetailSelection` (the fragment, so a reload lands on the same row),
 * and a surface inside somebody else's form keeps it in state. What this
 * component owns is that the two halves agree — the row drawn as selected is
 * the row the pane is showing, whatever holds it.
 */
export function ListDetail<T>({
  items,
  itemKey,
  listLabel,
  detailLabel,
  renderRow,
  renderDetail,
  selectedId,
  onSelect,
  backLabel,
  className,
}: ListDetailProps<T>) {
  const baseId = useId();
  const listRef = useRef<HTMLDivElement | null>(null);
  const ids = items.map(itemKey);
  // The index the keyboard last MOVED to, which is not always the index it
  // stands on: the row can be filtered away or deleted underneath it, and the
  // derivation below is what keeps the answer real. `-1` is "the keyboard has
  // not moved yet", which is what a fresh list starts from.
  const [moved, setMoved] = useState(-1);
  const focusIndex = listDetailFocusIndex(ids, selectedId, moved);
  const selectedIndex = selectedId === null ? -1 : ids.indexOf(selectedId);
  const open = selectedIndex >= 0;

  function focusRow(index: number | null): void {
    if (index === null) return;
    setMoved(index);
    const options = listRef.current?.querySelectorAll<HTMLElement>('[role="option"]');
    options?.[index]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const intent = listDetailKeyIntent(event.key);
    if (intent === "none") return;
    if (intent === "close") {
      // Only the open row has something to close, and the keyboard stays on it
      // rather than being sent back to the top of the list.
      if (!open) return;
      event.preventDefault();
      onSelect(null);
      focusRow(focusIndex >= 0 ? focusIndex : selectedIndex);
      return;
    }
    event.preventDefault();
    if (intent === "select") {
      const id = ids[focusIndex];
      if (id !== undefined) onSelect(id);
      return;
    }
    focusRow(listDetailStep(focusIndex, items.length, intent === "next" ? 1 : -1));
  }

  const classes = ["nx-listdetail"];
  if (open) classes.push("nx-listdetail--open");
  if (className) classes.push(className);

  return (
    <div className={classes.join(" ")}>
      <div
        ref={listRef}
        className="nx-listdetail__list"
        role="listbox"
        aria-label={listLabel}
        onKeyDown={onKeyDown}
      >
        {items.map((item, index) => {
          const id = ids[index] ?? "";
          return (
            <div
              key={id}
              className={
                id === selectedId
                  ? "nx-listdetail__row nx-listdetail__row--selected"
                  : "nx-listdetail__row"
              }
              {...listDetailRowProps({
                baseId,
                rowId: id,
                index,
                focusIndex,
                selected: id === selectedId,
              })}
              onClick={() => {
                setMoved(index);
                onSelect(id);
              }}
            >
              {renderRow(item)}
            </div>
          );
        })}
      </div>
      <section className="nx-listdetail__detail" aria-label={detailLabel}>
        <Button
          variant="quiet"
          className="nx-listdetail__back"
          onClick={() => {
            onSelect(null);
            focusRow(focusIndex >= 0 ? focusIndex : selectedIndex);
          }}
        >
          <Icon name="chevronLeft" size={15} />
          {backLabel}
        </Button>
        {renderDetail(open ? items[selectedIndex] ?? null : null)}
      </section>
    </div>
  );
}
