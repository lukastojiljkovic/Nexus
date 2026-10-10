/**
 * The keyboard and ARIA model of `ListDetail`, as values.
 *
 * The list is a WAI-ARIA listbox: one tab stop, real DOM focus on the option
 * the keyboard is standing on (`tabIndex` roves), and the selection following
 * the focus — the single-select variant the APG prescribes for a list whose
 * rows are a master view over one detail pane. Everything here is pure so a
 * test can pin it: Vitest runs with no DOM in this repository.
 */

import { wrappedStep } from "../focusCycle.js";

/** What one key press means. */
export type ListDetailIntent = "previous" | "next" | "select" | "close" | "none";

/**
 * The meaning of one key press inside the list.
 *
 * Enter selects the row the keyboard is standing on. Space is deliberately NOT
 * in this table: in a single-select listbox it means the same as Enter, and the
 * browser already scrolls the page on an unhandled Space — so answering it here
 * would take a page-level key away to repeat something Enter already does.
 */
export function listDetailKeyIntent(key: string): ListDetailIntent {
  if (key === "ArrowDown") return "next";
  if (key === "ArrowUp") return "previous";
  if (key === "Enter") return "select";
  if (key === "Escape") return "close";
  return "none";
}

/**
 * The index an arrow key moves the keyboard to, wrapping at both ends.
 *
 * `current` may be `-1` — the state before focus has entered the list — and the
 * wrap then lands on the first row going forward and the last going back.
 */
export function listDetailStep(current: number, count: number, direction: 1 | -1): number | null {
  return wrappedStep(current, count, direction);
}

/** The props one rendered row wears, derived from where the keyboard and the selection are. */
export interface ListDetailRowProps {
  readonly id: string;
  readonly role: "option";
  readonly "aria-selected": boolean;
  /**
   * Exactly one row in the list is in the tab order — the one the keyboard is
   * standing on, or the selected row, or the first. Everything else is `-1`, so
   * the list is one stop rather than one stop per row.
   */
  readonly tabIndex: number;
}

export function listDetailRowProps(input: {
  readonly baseId: string;
  readonly rowId: string;
  readonly index: number;
  readonly focusIndex: number;
  readonly selected: boolean;
}): ListDetailRowProps {
  const { baseId, rowId, index, focusIndex, selected } = input;
  const stop = focusIndex >= 0 ? focusIndex : 0;
  return {
    id: `${baseId}-${rowId}`,
    role: "option",
    "aria-selected": selected,
    tabIndex: index === stop ? 0 : -1,
  };
}

/**
 * Where the keyboard stands when the list is (re)rendered.
 *
 * The selected row if there is one, the first row otherwise. Clamped to the
 * list: a selection can outlive the row it named — the row was filtered away,
 * or deleted — and the keyboard has to land somewhere real rather than on an
 * index that no longer exists.
 */
export function listDetailFocusIndex(
  ids: readonly string[],
  selectedId: string | null,
  previous: number,
): number {
  if (ids.length === 0) return -1;
  const selected = selectedId === null ? -1 : ids.indexOf(selectedId);
  if (selected >= 0) return selected;
  if (previous < 0) return 0;
  return previous < ids.length ? previous : ids.length - 1;
}
