import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * The generic floating command/autocomplete panel behind both the slash menu
 * (NOTE slice a2) and the `[[` wiki-link menu (NOTE-004b): a tokens-styled
 * surface positioned at the caret, portalled to `document.body`. Keyboard
 * (↑/↓/Enter) is routed in from whichever `@tiptap/suggestion` plugin owns the
 * trigger; Escape is handled by the plugin itself (it dispatches `onExit`).
 * The active row is typographic (gold + weight) over a soft surface — no
 * glow, no inset bar. Extracted from the original `SlashMenu` — no behavior
 * change to the slash menu, which now delegates here.
 */

export interface SuggestionMenuProps<T> {
  items: T[];
  getKey: (item: T) => string;
  getLabel: (item: T) => string;
  command: (item: T) => void;
  rect: DOMRect | null;
  /** Publishes the panel's key handler up to the owning extension's `onKeyDown`. */
  registerKeydown: (handler: (event: KeyboardEvent) => boolean) => void;
}

export function SuggestionMenu<T>({
  items,
  getKey,
  getLabel,
  command,
  rect,
  registerKeydown,
}: SuggestionMenuProps<T>) {
  const [index, setIndex] = useState(0);
  const indexRef = useRef(0);

  // A fresh item set (query changed) resets the highlight to the first row.
  useEffect(() => {
    setIndex(0);
    indexRef.current = 0;
  }, [items]);

  useEffect(() => {
    indexRef.current = index;
  }, [index]);

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

  if (!rect || items.length === 0) return null;

  return createPortal(
    <div
      className="note__slash"
      style={{ top: rect.bottom + 4, left: rect.left }}
      role="listbox"
    >
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
    document.body,
  );
}
