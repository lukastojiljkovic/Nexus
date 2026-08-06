import { useEffect, useRef, useState } from "react";

import { CARET_GAP } from "./anchoredPlacement.js";
import { useAnchoredPosition } from "./useAnchoredPosition.js";

/**
 * The generic floating command/autocomplete panel behind both the slash menu
 * (NOTE slice a2) and the `[[` wiki-link menu (NOTE-004b): a tokens-styled
 * surface positioned at the caret, portalled to `document.body`. Keyboard
 * (↑/↓/Enter) is routed in from whichever `@tiptap/suggestion` plugin owns the
 * trigger; Escape is handled by the plugin itself (it dispatches `onExit`), so
 * this panel asks `useAnchoredPosition` for placement only and hands it no
 * `onClose` — its lifetime is not its own.
 * The active row is typographic (gold + weight) over a soft surface — no
 * glow, no inset bar. Extracted from the original `SlashMenu` — no behavior
 * change to the slash menu, which now delegates here.
 */

export interface SuggestionMenuProps<T> {
  items: T[];
  getKey: (item: T) => string;
  getLabel: (item: T) => string;
  command: (item: T) => void;
  /**
   * The caret's rectangle, as a LIVE getter (`@tiptap/suggestion`'s own
   * `clientRect`, which re-reads the decoration node every call). Never a
   * snapshot: the caret can sit on the last visible line of a pane that then
   * scrolls, and a panel holding the coordinates it was born with would be left
   * standing where the text used to be.
   */
  getRect: () => DOMRect | null;
  /** Publishes the panel's key handler up to the owning extension's `onKeyDown`. */
  registerKeydown: (handler: (event: KeyboardEvent) => boolean) => void;
}

export function SuggestionMenu<T>({
  items,
  getKey,
  getLabel,
  command,
  getRect,
  registerKeydown,
}: SuggestionMenuProps<T>) {
  const [index, setIndex] = useState(0);
  const indexRef = useRef(0);
  // `align: "start"` reads left-to-right from the typing point; the wider gap
  // keeps the panel clear of the descenders on the line being typed.
  const { panelRef, panelProps, portal } = useAnchoredPosition({
    open: items.length > 0,
    anchor: getRect,
    align: "start",
    gap: CARET_GAP,
  });

  // A fresh item set (query changed) resets the highlight to the first row.
  useEffect(() => {
    setIndex(0);
    indexRef.current = 0;
  }, [items]);

  useEffect(() => {
    indexRef.current = index;
  }, [index]);

  // Keeps the keyboard-active row inside the panel's scroll window — reachable
  // since NOTE-009c appends every template after the ten block commands, so the
  // list now routinely outgrows the panel. Scrolled by hand rather than with
  // `scrollIntoView`, which would also be free to scroll the editor pane behind
  // this portalled, fixed-position panel.
  useEffect(() => {
    const panel = panelRef.current;
    const active = panel?.children[index];
    if (!panel || !(active instanceof HTMLElement)) return;
    const bottom = active.offsetTop + active.offsetHeight;
    if (active.offsetTop < panel.scrollTop) {
      panel.scrollTop = active.offsetTop;
    } else if (bottom > panel.scrollTop + panel.clientHeight) {
      panel.scrollTop = bottom - panel.clientHeight;
    }
  }, [index, items, panelRef]);

  useEffect(() => {
    registerKeydown((event) => {
      if (items.length === 0) return false;
      if (event.key === "ArrowDown") {
        setIndex((current) => (current + 1) % items.length);
        return true;
      }
      if (event.key === "ArrowUp") {
        setIndex((current) => (current - 1 + items.length) % items.length);
        return true;
      }
      if (event.key === "Enter") {
        const selected = items[indexRef.current];
        if (selected) command(selected);
        return true;
      }
      return false;
    });
  }, [items, command, registerKeydown]);

  if (items.length === 0) return null;

  return portal(
    <div className="note__slash" role="listbox" {...panelProps}>
      {items.map((item, position) => (
        <button
          key={getKey(item)}
          type="button"
          role="option"
          aria-selected={position === index}
          className={
            position === index
              ? "note__slash-item note__slash-item--active"
              : "note__slash-item"
          }
          // mousedown (not click) so the editor keeps its selection/focus.
          onMouseDown={(event) => {
            event.preventDefault();
            command(item);
          }}
          onMouseEnter={() => setIndex(position)}
        >
          {getLabel(item)}
        </button>
      ))}
    </div>,
  );
}
